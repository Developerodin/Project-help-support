import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import RbacAuditLog from '../rbacAuditLog.model.js';
import RbacAuditOutbox from '../rbacAuditOutbox.model.js';
import {
  AUDIT_OUTBOX_CLAIM_STALE_MS,
  MAX_AUDIT_OUTBOX_ATTEMPTS,
  retryPendingAuditOutbox,
} from '../rbac-audit.js';
import {
  getRoleMatrix,
  listAuditLog,
  updateRoleMatrix,
  updateUserPermissionOverrides,
} from '../rbac.service.js';
import { createScopedAssignment } from '../../access/scoped-access.service.js';
import Client from '../../clients/client.model.js';

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

test('policy mutations append audit log rows', async () => {
  const admin = await createUser({ email: 'audit-admin@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'audit-dev@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const baseline = (await getRoleMatrix(admin)).effective;

  await updateRoleMatrix(admin, {
    grants: {
      [ROLE_IDS.DEVELOPER]: [...baseline[ROLE_IDS.DEVELOPER], 'tickets.assign'],
    },
  });

  await updateUserPermissionOverrides(admin, developer._id, {
    overrides: { 'tickets.assign': 'allow' },
  });

  const client = await Client.create({ name: 'Audit Co', status: 'active', createdBy: admin._id });
  await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: client._id,
    environments: ['Staging'],
    reason: 'Scoped delivery',
  });

  const listed = await listAuditLog(admin, { targetUserId: developer._id, limit: 10 });
  assert.ok(listed.results.some((row) => row.action === 'scoped_assignment.create'));

  const policyListed = await listAuditLog(admin, { category: 'policy', limit: 50 });
  assert.ok(policyListed.results.some((row) => row.action === 'role_matrix.update'));
  assert.ok(policyListed.results.some((row) => row.action === 'user_overrides.update'));

  const stored = await RbacAuditLog.countDocuments({ targetUser: developer._id });
  assert.ok(stored >= 1);
});

test('listAuditLog filters by category', async () => {
  const admin = await createUser({ email: 'audit-filter@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;
  const beforePolicy = await RbacAuditLog.countDocuments({ category: 'policy' });

  await updateRoleMatrix(admin, {
    grants: {
      [ROLE_IDS.TESTER]: [...baseline[ROLE_IDS.TESTER], 'tickets.assign'],
    },
  });

  const afterPolicy = await RbacAuditLog.countDocuments({ category: 'policy' });
  assert.ok(afterPolicy > beforePolicy);

  const policyOnly = await listAuditLog(admin, { category: 'policy', limit: 20 });
  assert.ok(policyOnly.results.every((row) => row.category === 'policy'));
});

test('role matrix update succeeds when audit persistence fails and outbox replay restores audit', async () => {
  const admin = await createUser({ email: 'audit-matrix-fail@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;

  const createMock = mock.method(RbacAuditLog, 'create', async () => {
    throw new Error('simulated audit write failure');
  });

  await updateRoleMatrix(admin, {
    grants: {
      [ROLE_IDS.DEVELOPER]: [...baseline[ROLE_IDS.DEVELOPER], 'tickets.assign'],
    },
  });

  createMock.mock.restore();

  assert.equal(await RbacAuditLog.countDocuments({ action: 'role_matrix.update' }), 0);
  assert.equal(await RbacAuditOutbox.countDocuments({ action: 'role_matrix.update' }), 1);

  const replay = await retryPendingAuditOutbox();
  assert.equal(replay.replayed, 1);
  assert.equal(await RbacAuditLog.countDocuments({ action: 'role_matrix.update' }), 1);
});

test('retryPendingAuditOutbox is idempotent when queue is already drained', async () => {
  const admin = await createUser({ email: 'audit-idempotent@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;

  const createMock = mock.method(RbacAuditLog, 'create', async () => {
    throw new Error('simulated audit write failure');
  });

  await updateRoleMatrix(admin, {
    grants: {
      [ROLE_IDS.SUPPORT]: [...baseline[ROLE_IDS.SUPPORT], 'tickets.assign'],
    },
  });

  createMock.mock.restore();

  const first = await retryPendingAuditOutbox();
  assert.equal(first.replayed, 1);
  assert.equal(first.remaining, 0);

  const second = await retryPendingAuditOutbox();
  assert.equal(second.replayed, 0);
  assert.equal(second.remaining, 0);
  assert.equal(await RbacAuditLog.countDocuments({ action: 'role_matrix.update' }), 1);
});

async function queueOutboxRow(actor, extra = {}) {
  return RbacAuditOutbox.create({
    action: 'role_matrix.update',
    actor: actor._id,
    details: { note: 'queued' },
    attempts: 1,
    status: 'pending',
    ...extra,
  });
}

test('two replayers running at once write each outbox row exactly once', async () => {
  await RbacAuditLog.deleteMany({});
  await RbacAuditOutbox.deleteMany({});
  await RbacAuditLog.syncIndexes();
  const admin = await createUser({ email: 'audit-race@example.com', roles: [ROLE_IDS.ADMIN] });
  await queueOutboxRow(admin);
  await queueOutboxRow(admin);
  await queueOutboxRow(admin);

  const [a, b] = await Promise.all([retryPendingAuditOutbox(), retryPendingAuditOutbox()]);
  assert.equal(a.replayed + b.replayed, 3);
  assert.equal(await RbacAuditLog.countDocuments({ action: 'role_matrix.update' }), 3);
  assert.equal(await RbacAuditOutbox.countDocuments({}), 0);
});

test('a duplicate insert for the same outbox row is rejected and treated as done', async () => {
  await RbacAuditLog.deleteMany({});
  await RbacAuditOutbox.deleteMany({});
  await RbacAuditLog.syncIndexes();
  const admin = await createUser({ email: 'audit-dup@example.com', roles: [ROLE_IDS.ADMIN] });
  const row = await queueOutboxRow(admin);
  // A replayer that died after writing the log but before deleting its row.
  await RbacAuditLog.create({
    action: 'role_matrix.update', category: 'policy', actor: admin._id, details: { outboxId: String(row._id) },
  });
  await assert.rejects(
    RbacAuditLog.create({
      action: 'other', category: 'policy', actor: admin._id, details: { outboxId: String(row._id) },
    }),
    (err) => err.code === 11000,
  );

  const existsMock = mock.method(RbacAuditLog, 'exists', async () => null);
  const result = await retryPendingAuditOutbox();
  existsMock.mock.restore();
  assert.equal(result.replayed, 1);
  assert.equal(await RbacAuditLog.countDocuments({ 'details.outboxId': String(row._id) }), 1);
  assert.equal(await RbacAuditOutbox.countDocuments({}), 0);
});

test('a stale processing claim is taken over; a fresh one is left alone', async () => {
  await RbacAuditOutbox.deleteMany({});
  const admin = await createUser({ email: 'audit-stale@example.com', roles: [ROLE_IDS.ADMIN] });
  const stale = await queueOutboxRow(admin, {
    status: 'processing', claimedAt: new Date(Date.now() - AUDIT_OUTBOX_CLAIM_STALE_MS - 1000),
  });
  const fresh = await queueOutboxRow(admin, { status: 'processing', claimedAt: new Date() });

  const result = await retryPendingAuditOutbox();
  assert.equal(result.replayed, 1);
  assert.equal(await RbacAuditOutbox.exists({ _id: stale._id }), null);
  assert.ok(await RbacAuditOutbox.exists({ _id: fresh._id, status: 'processing' }));
});

test('a row that keeps failing moves to failed at the attempt cap', async () => {
  await RbacAuditOutbox.deleteMany({});
  const admin = await createUser({ email: 'audit-cap@example.com', roles: [ROLE_IDS.ADMIN] });
  const row = await queueOutboxRow(admin, { attempts: MAX_AUDIT_OUTBOX_ATTEMPTS - 2 });
  const createMock = mock.method(RbacAuditLog, 'create', async () => {
    throw new Error('still down');
  });

  const first = await retryPendingAuditOutbox();
  assert.equal(first.replayed, 0);
  let stored = await RbacAuditOutbox.findById(row._id);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.attempts, MAX_AUDIT_OUTBOX_ATTEMPTS - 1);

  await retryPendingAuditOutbox();
  createMock.mock.restore();
  stored = await RbacAuditOutbox.findById(row._id);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.attempts, MAX_AUDIT_OUTBOX_ATTEMPTS);
  assert.equal(stored.lastError, 'still down');

  const after = await retryPendingAuditOutbox();
  assert.equal(after.replayed, 0, 'failed rows are not retried');
});
