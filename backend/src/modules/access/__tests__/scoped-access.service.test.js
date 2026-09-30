import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../../projects/project.model.js';
import AccessAssignment from '../accessAssignment.model.js';
import {
  createScopedAssignment,
  listUserScopedAssignments,
  loadScopedAssignmentsForUser,
  revokeScopedAssignment,
  updateScopedAssignment,
} from '../scoped-access.service.js';
import { loadPermissionContextForUser } from '../../rbac/rbac.service.js';
import { canInScope } from '@pms/shared';
import { ApiError } from '../../../platform/errors.js';
import RbacAuditLog from '../../rbac/rbacAuditLog.model.js';
import RbacAuditOutbox from '../../rbac/rbacAuditOutbox.model.js';
import { retryPendingAuditOutbox } from '../../rbac/rbac-audit.js';

withMemoryDb();

async function createUser({ email, roles, password = 'password123' }) {
  return User.create({
    name: email.split('@')[0],
    email,
    password,
    roles,
    role: roles[0],
    status: 'active',
  });
}

async function seedClientProject(actor, suffix = '') {
  const client = await Client.create({
    name: suffix ? `Acme-${suffix}` : 'Acme',
    status: 'active',
    createdBy: actor._id,
  });
  const project = await Project.create({
    key: suffix ? `ACME${suffix}` : 'ACME',
    name: 'Portal',
    client: client._id,
    status: 'active',
    createdBy: actor._id,
  });
  return { client, project };
}

test('createScopedAssignment persists validated scope and appears in permission context', async () => {
  const admin = await createUser({ email: 'admin-scope@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Delivery support',
  });

  assert.equal(created.role, ROLE_IDS.DEVELOPER);
  assert.equal(String(created.clientId), String(client._id));
  assert.equal(String(created.projectId), String(project._id));

  const context = await loadPermissionContextForUser(developer._id);
  assert.equal(context.scopedAssignments.length, 1);
  assert.equal(context.scopedAssignments[0].role, ROLE_IDS.DEVELOPER);
});

test('createScopedAssignment rejects self-delegation and duplicate active scope', async () => {
  const admin = await createUser({ email: 'admin-scope2@example.com', roles: [ROLE_IDS.ADMIN] });
  const { client, project } = await seedClientProject(admin);

  await assert.rejects(
    () => createScopedAssignment(admin, admin._id, {
      role: ROLE_IDS.DEVELOPER,
      clientId: client._id,
      projectId: project._id,
      environments: ['Staging'],
      reason: 'Self grant',
    }),
    (err) => err instanceof ApiError && err.code === 'CANNOT_DELEGATE_SELF',
  );

  const developer = await createUser({ email: 'dev-scope2@example.com', roles: [ROLE_IDS.DEVELOPER] });
  await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Initial grant',
  });

  await assert.rejects(
    () => createScopedAssignment(admin, developer._id, {
      role: ROLE_IDS.DEVELOPER,
      clientId: client._id,
      projectId: project._id,
      environments: ['Staging'],
      reason: 'Duplicate grant',
    }),
    (err) => err instanceof ApiError && err.code === 'ASSIGNMENT_EXISTS',
  );
});

test('updateScopedAssignment supports optimistic concurrency via ifMatch', async () => {
  const admin = await createUser({ email: 'admin-scope3@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope3@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Initial grant',
  });

  const stale = new Date(Date.now() - 60_000).toISOString();
  await assert.rejects(
    () => updateScopedAssignment(admin, created.id, {
      environments: ['Staging', 'Production'],
      reason: 'Production support',
      ifMatch: stale,
    }),
    (err) => err instanceof ApiError && err.code === 'ASSIGNMENT_CONFLICT',
  );

  const updated = await updateScopedAssignment(admin, created.id, {
    environments: ['Staging', 'Production'],
    reason: 'Production support',
    ifMatch: created.updatedAt,
  });
  assert.deepEqual(updated.environments, ['Staging', 'Production']);
});

test('update without ifMatch follows documented last-write-wins semantics', async () => {
  const admin = await createUser({ email: 'admin-scope4@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope4@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Initial grant',
  });

  const first = await updateScopedAssignment(admin, created.id, {
    environments: ['Staging'],
    reason: 'Writer A',
  });
  const second = await updateScopedAssignment(admin, created.id, {
    environments: ['Production'],
    reason: 'Writer B',
  });

  assert.equal(second.reason, 'Writer B');
  assert.deepEqual(second.environments, ['Production']);
  assert.notEqual(first.updatedAt, second.updatedAt);
});

test('revokeScopedAssignment requires reason and removes active row from listings', async () => {
  const admin = await createUser({ email: 'admin-scope5@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope5@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Initial grant',
  });

  const revoked = await revokeScopedAssignment(admin, created.id, {
    reason: 'Access no longer required',
    ifMatch: created.updatedAt,
  });
  assert.equal(revoked.status, 'revoked');

  const activeOnly = await loadScopedAssignmentsForUser(developer._id);
  assert.equal(activeOnly.length, 0);

  const listing = await listUserScopedAssignments(admin, developer._id);
  assert.equal(listing.assignments.length, 1);
  assert.equal(listing.assignments[0].status, 'revoked');
});

test('createScopedAssignment rejects production access without reason', async () => {
  const admin = await createUser({ email: 'admin-scope6@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope6@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  await assert.rejects(
    () => createScopedAssignment(admin, developer._id, {
      role: ROLE_IDS.DEVELOPER,
      clientId: client._id,
      projectId: project._id,
      environments: ['Production'],
    }),
    (err) => err instanceof ApiError && err.code === 'REASON_REQUIRED',
  );
});

test('permission context enforces scoped client/project checks with serialized assignments', async () => {
  const admin = await createUser({ email: 'admin-scope7@example.com', roles: [ROLE_IDS.ADMIN] });
  const projectAdmin = await createUser({ email: 'pa-scope7@example.com', roles: [ROLE_IDS.PROJECT_ADMIN] });
  const { client, project } = await seedClientProject(admin);

  await createScopedAssignment(admin, projectAdmin._id, {
    role: ROLE_IDS.PROJECT_ADMIN,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Scoped admin',
  });

  const context = await loadPermissionContextForUser(projectAdmin._id);
  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: client._id, projectId: project._id }, context),
    true,
  );
  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: client._id, projectId: new mongoose.Types.ObjectId() }, context),
    false,
  );
});

test('expired scoped assignments are denied by permission checks', async () => {
  const admin = await createUser({ email: 'admin-scope8@example.com', roles: [ROLE_IDS.ADMIN] });
  const projectAdmin = await createUser({ email: 'pa-scope8@example.com', roles: [ROLE_IDS.PROJECT_ADMIN] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, projectAdmin._id, {
    role: ROLE_IDS.PROJECT_ADMIN,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Temporary access',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await AccessAssignment.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(created.id) },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } },
  );

  const context = await loadPermissionContextForUser(projectAdmin._id);
  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: client._id, projectId: project._id }, context),
    false,
  );
});

test('revokeScopedAssignment succeeds on naturally expired assignment', async () => {
  const admin = await createUser({ email: 'admin-scope9@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope9@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Initial grant',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await AccessAssignment.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(created.id) },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } },
  );

  const expired = await AccessAssignment.findById(created.id);
  const revoked = await revokeScopedAssignment(admin, created.id, {
    reason: 'Cleanup expired grant',
    ifMatch: expired.updatedAt,
  });
  assert.equal(revoked.status, 'revoked');
});

test('updateScopedAssignment with ifMatch rejects concurrent modification', async () => {
  const admin = await createUser({ email: 'admin-scope10@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope10@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Initial grant',
  });

  const firstWriter = await updateScopedAssignment(admin, created.id, {
    environments: ['Staging'],
    reason: 'Writer A',
    ifMatch: created.updatedAt,
  });

  await assert.rejects(
    () => updateScopedAssignment(admin, created.id, {
      environments: ['Production'],
      reason: 'Writer B',
      ifMatch: created.updatedAt,
    }),
    (err) => err instanceof ApiError && err.code === 'ASSIGNMENT_CONFLICT',
  );

  const secondWriter = await updateScopedAssignment(admin, created.id, {
    environments: ['Production'],
    reason: 'Writer B',
    ifMatch: firstWriter.updatedAt,
  });
  assert.equal(secondWriter.reason, 'Writer B');
});

test('updateScopedAssignment with ifMatch can update expiresAt on active assignment', async () => {
  const admin = await createUser({ email: 'admin-scope11@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope11@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Initial grant',
  });

  const futureExpiry = new Date(Date.now() + 120_000);
  const updated = await updateScopedAssignment(admin, created.id, {
    expiresAt: futureExpiry,
    ifMatch: created.updatedAt,
  });
  assert.equal(new Date(updated.expiresAt).getTime(), futureExpiry.getTime());
});

test('expired Project Admin cannot authorize scoped assignment management', async () => {
  const admin = await createUser({ email: 'admin-scope-exp@example.com', roles: [ROLE_IDS.ADMIN] });
  const projectAdmin = await createUser({ email: 'pa-scope-exp@example.com', roles: [ROLE_IDS.PROJECT_ADMIN] });
  const developer = await createUser({ email: 'dev-scope-exp@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, projectAdmin._id, {
    role: ROLE_IDS.PROJECT_ADMIN,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Temporary admin',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await AccessAssignment.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(created.id) },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } },
  );

  await assert.rejects(
    () => createScopedAssignment(projectAdmin, developer._id, {
      role: ROLE_IDS.DEVELOPER,
      clientId: client._id,
      projectId: project._id,
      environments: ['Staging'],
      reason: 'Should be denied',
    }),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );

  const target = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Admin grant',
  });

  await assert.rejects(
    () => updateScopedAssignment(projectAdmin, target.id, {
      environments: ['Production'],
      reason: 'Should be denied',
    }),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );

  await assert.rejects(
    () => revokeScopedAssignment(projectAdmin, target.id, { reason: 'Should be denied' }),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );
});

test('createScopedAssignment allows same-scope re-grant after expiry', async () => {
  const admin = await createUser({ email: 'admin-scope-renew@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope-renew@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Initial grant',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await AccessAssignment.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(created.id) },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } },
  );

  const renewed = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Renewed grant',
  });

  assert.equal(renewed.status, 'active');
  assert.equal(renewed.reason, 'Renewed grant');

  const activeOnly = await loadScopedAssignmentsForUser(developer._id);
  assert.equal(activeOnly.length, 1);
  assert.equal(activeOnly[0].id, renewed.id);
});

test('updateScopedAssignment with ifMatch rejects past expiresAt on active assignment', async () => {
  const admin = await createUser({ email: 'admin-scope12@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope12@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Initial grant',
  });

  await assert.rejects(
    () => updateScopedAssignment(admin, created.id, {
      expiresAt: new Date(Date.now() - 60_000),
      ifMatch: created.updatedAt,
    }),
    (err) => err.name === 'ValidationError',
  );
});

test('listUserScopedAssignments filters assignments outside actor scope', async () => {
  const admin = await createUser({ email: 'admin-scope-list@example.com', roles: [ROLE_IDS.ADMIN] });
  const projectAdmin = await createUser({ email: 'pa-scope-list@example.com', roles: [ROLE_IDS.PROJECT_ADMIN] });
  const developer = await createUser({ email: 'dev-scope-list@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const scopeA = await seedClientProject(admin, 'A');
  const scopeB = await seedClientProject(admin, 'B');

  await createScopedAssignment(admin, projectAdmin._id, {
    role: ROLE_IDS.PROJECT_ADMIN,
    clientId: scopeA.client._id,
    projectId: scopeA.project._id,
    environments: ['Staging'],
    reason: 'Scoped admin A',
  });

  const assignmentA = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: scopeA.client._id,
    projectId: scopeA.project._id,
    environments: ['Staging'],
    reason: 'Grant A',
  });
  await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: scopeB.client._id,
    projectId: scopeB.project._id,
    environments: ['Staging'],
    reason: 'Grant B',
  });

  const adminListing = await listUserScopedAssignments(admin, developer._id);
  assert.equal(adminListing.assignments.length, 2);

  const scopedListing = await listUserScopedAssignments(projectAdmin, developer._id);
  assert.equal(scopedListing.assignments.length, 1);
  assert.equal(scopedListing.assignments[0].id, assignmentA.id);
});

test('updateScopedAssignment requires authority on both existing and requested scope', async () => {
  const admin = await createUser({ email: 'admin-scope-migrate@example.com', roles: [ROLE_IDS.ADMIN] });
  const projectAdmin = await createUser({ email: 'pa-scope-migrate@example.com', roles: [ROLE_IDS.PROJECT_ADMIN] });
  const developer = await createUser({ email: 'dev-scope-migrate@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const scopeA = await seedClientProject(admin, 'A');
  const scopeB = await seedClientProject(admin, 'B');

  await createScopedAssignment(admin, projectAdmin._id, {
    role: ROLE_IDS.PROJECT_ADMIN,
    clientId: scopeA.client._id,
    projectId: scopeA.project._id,
    environments: ['Staging'],
    reason: 'Scoped admin A',
  });

  const inScope = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: scopeA.client._id,
    projectId: scopeA.project._id,
    environments: ['Staging'],
    reason: 'Grant A',
  });

  await assert.rejects(
    () => updateScopedAssignment(projectAdmin, inScope.id, {
      clientId: scopeB.client._id,
      projectId: scopeB.project._id,
      reason: 'Migrate out of authority',
    }),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );

  const outOfScope = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: scopeB.client._id,
    projectId: scopeB.project._id,
    environments: ['Staging'],
    reason: 'Grant B',
  });

  await assert.rejects(
    () => updateScopedAssignment(projectAdmin, outOfScope.id, {
      environments: ['Production'],
      reason: 'Touch assignment outside actor scope',
    }),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );
});

test('createScopedAssignment rejects external role without company scope', async () => {
  const admin = await createUser({ email: 'admin-scope-ext@example.com', roles: [ROLE_IDS.ADMIN] });
  const clientUser = await createUser({ email: 'client-scope-ext@example.com', roles: [ROLE_IDS.CLIENT] });

  await assert.rejects(
    () => createScopedAssignment(admin, clientUser._id, {
      role: ROLE_IDS.CLIENT,
      clientId: null,
      projectId: null,
      environments: ['Staging'],
      reason: 'Missing company',
    }),
    (err) => err instanceof ApiError && err.code === 'CLIENT_REQUIRED',
  );
});

test('createScopedAssignment company-wide client_tester inherits to active projects', async () => {
  const admin = await createUser({ email: 'admin-scope-inherit@example.com', roles: [ROLE_IDS.ADMIN] });
  const tester = await createUser({ email: 'tester-scope-inherit@example.com', roles: [ROLE_IDS.CLIENT_TESTER] });
  const { client, project } = await seedClientProject(admin);

  await createScopedAssignment(admin, tester._id, {
    role: ROLE_IDS.CLIENT_TESTER,
    clientId: client._id,
    projectId: null,
    environments: ['Staging'],
    reason: 'Company-wide tester',
  });

  const projectRow = await AccessAssignment.findOne({
    client: client._id,
    project: project._id,
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
  });
  assert.ok(projectRow);
});

test('createScopedAssignment rejects mismatched external role on target user', async () => {
  const admin = await createUser({ email: 'admin-scope-ext2@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-scope-ext2@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client } = await seedClientProject(admin);

  await assert.rejects(
    () => createScopedAssignment(admin, developer._id, {
      role: ROLE_IDS.CLIENT_TESTER,
      clientId: client._id,
      projectId: null,
      environments: ['Staging'],
      reason: 'Wrong global role',
    }),
    (err) => err instanceof ApiError && err.code === 'INVALID_EXTERNAL_USER',
  );
});

test('scoped assignment mutation succeeds when audit persistence fails and queues outbox row', async () => {
  const admin = await createUser({ email: 'admin-audit-fail@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-audit-fail@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const createMock = mock.method(RbacAuditLog, 'create', async () => {
    throw new Error('simulated audit write failure');
  });

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Audit failure path',
  });

  createMock.mock.restore();

  assert.equal(created.status, 'active');
  assert.equal(await RbacAuditLog.countDocuments({ action: 'scoped_assignment.create' }), 0);
  assert.equal(await RbacAuditOutbox.countDocuments({ action: 'scoped_assignment.create' }), 1);

  const replay = await retryPendingAuditOutbox();
  assert.equal(replay.replayed, 1);
  assert.equal(await RbacAuditLog.countDocuments({ action: 'scoped_assignment.create' }), 1);
  assert.equal(await RbacAuditOutbox.countDocuments({ status: 'pending' }), 0);
});

test('revokeExpiredActiveDuplicates clears stale rows before same-scope re-grant', async () => {
  const admin = await createUser({ email: 'admin-expired-dup@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-expired-dup@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const { client, project } = await seedClientProject(admin);

  const created = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Initial grant',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await AccessAssignment.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(created.id) },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } },
  );

  const renewed = await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    projectId: project._id,
    environments: ['Staging'],
    reason: 'Renewed after expiry cleanup',
  });

  assert.equal(renewed.status, 'active');
  const revoked = await AccessAssignment.findById(created.id);
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.reason, 'expired');
});
