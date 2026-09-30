import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ROLE_IDS, ROLE_PERMISSIONS, mergeRoleMatrixWithBaseline } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import RoleMatrix from '../roleMatrix.model.js';
import {
  getEffectiveRoleMatrixRecord,
  getRoleMatrix,
  getUserPermissionOverrides,
  loadPermissionContextForUser,
  updateRoleMatrix,
  updateUserPermissionOverrides,
} from '../rbac.service.js';
import { ApiError } from '../../../platform/errors.js';

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

test('empty read_only role exposes baseline view permissions in effective matrix', async () => {
  const admin = await createUser({ email: 'admin-empty-role@example.com', roles: [ROLE_IDS.ADMIN] });
  const matrix = await getRoleMatrix(admin);
  assert.equal(matrix.customizations, null);
  assert.ok(matrix.effective[ROLE_IDS.READ_ONLY].includes('clients.view'));
  assert.ok(matrix.effective[ROLE_IDS.READ_ONLY].includes('tickets.view'));
  assert.ok(!matrix.effective[ROLE_IDS.READ_ONLY].includes('tickets.create'));

  const effectiveOnly = await getEffectiveRoleMatrixRecord();
  assert.ok(effectiveOnly[ROLE_IDS.READ_ONLY].includes('tickets.view'));
});

test('updateRoleMatrix revokes previously granted permission', async () => {
  const admin = await createUser({ email: 'admin-revoke@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;
  const readOnlyWithCreate = [...baseline[ROLE_IDS.READ_ONLY], 'tickets.create'];

  await updateRoleMatrix(admin, {
    grants: { [ROLE_IDS.READ_ONLY]: readOnlyWithCreate },
  });

  const revoked = await updateRoleMatrix(admin, {
    grants: { [ROLE_IDS.READ_ONLY]: baseline[ROLE_IDS.READ_ONLY] },
  });
  assert.ok(!revoked.effective[ROLE_IDS.READ_ONLY].includes('tickets.create'));
  assert.ok(!Object.prototype.hasOwnProperty.call(revoked.customizations || {}, ROLE_IDS.READ_ONLY));
  assert.ok(!Object.prototype.hasOwnProperty.call(revoked.customizations || {}, ROLE_IDS.DEVELOPER));

  const reloaded = await getRoleMatrix(admin);
  assert.ok(!reloaded.effective[ROLE_IDS.READ_ONLY].includes('tickets.create'));
  assert.ok(!Object.prototype.hasOwnProperty.call(reloaded.customizations || {}, ROLE_IDS.READ_ONLY));
});

test('sparse stored matrix does not wipe untouched role baselines', async () => {
  const admin = await createUser({ email: 'admin-sparse@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;

  await updateRoleMatrix(admin, {
    grants: {
      [ROLE_IDS.DEVELOPER]: [...baseline[ROLE_IDS.DEVELOPER], 'tickets.delete'],
    },
  });

  const reloaded = await getRoleMatrix(admin);
  assert.ok(reloaded.effective[ROLE_IDS.ADMIN].includes('users.manage'));
  assert.ok(reloaded.effective[ROLE_IDS.DEVELOPER].includes('tickets.delete'));
});

test('super admin can manage role matrix', async () => {
  const superAdmin = await createUser({ email: 'root-matrix@example.com', roles: [ROLE_IDS.SUPER_ADMIN] });
  const matrix = await getRoleMatrix(superAdmin);
  assert.ok(matrix.effective[ROLE_IDS.ADMIN].includes('users.manage'));
});

test('role matrix changes for one role do not affect another role baseline', async () => {
  const admin = await createUser({ email: 'admin-isolation@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).baseline;

  await updateRoleMatrix(admin, {
    grants: {
      [ROLE_IDS.TESTER]: [...baseline[ROLE_IDS.TESTER], 'tickets.delete'],
    },
  });

  const reloaded = await getRoleMatrix(admin);
  assert.ok(!baseline[ROLE_IDS.TESTER].includes('tickets.delete'));
  assert.ok(reloaded.effective[ROLE_IDS.TESTER].includes('tickets.delete'));
  assert.deepEqual(reloaded.effective[ROLE_IDS.DEVELOPER], baseline[ROLE_IDS.DEVELOPER]);
});

test('updateRoleMatrix persists custom grants for read_only role', async () => {
  const admin = await createUser({ email: 'admin-readonly@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;
  const readOnlyGrants = [...baseline[ROLE_IDS.READ_ONLY], 'tickets.create'];

  const updated = await updateRoleMatrix(admin, {
    grants: { [ROLE_IDS.READ_ONLY]: readOnlyGrants },
  });

  assert.ok(updated.effective[ROLE_IDS.READ_ONLY].includes('tickets.create'));
  assert.deepEqual(updated.customizations[ROLE_IDS.READ_ONLY], { add: ['tickets.create'], remove: [] });
  assert.ok(!Object.prototype.hasOwnProperty.call(updated.customizations, ROLE_IDS.DEVELOPER));

  const reloaded = await getRoleMatrix(admin);
  assert.ok(reloaded.effective[ROLE_IDS.READ_ONLY].includes('tickets.create'));
  assert.deepEqual(reloaded.customizations[ROLE_IDS.READ_ONLY], { add: ['tickets.create'], remove: [] });
  assert.ok(!Object.prototype.hasOwnProperty.call(reloaded.customizations, ROLE_IDS.CLIENT));
});

test('explicit empty read_only grants do not fall back to baseline VIEW', async () => {
  const admin = await createUser({ email: 'admin-explicit-empty@example.com', roles: [ROLE_IDS.ADMIN] });

  const updated = await updateRoleMatrix(admin, {
    grants: { [ROLE_IDS.READ_ONLY]: [] },
  });

  assert.deepEqual(updated.effective[ROLE_IDS.READ_ONLY], []);
  assert.deepEqual(updated.customizations[ROLE_IDS.READ_ONLY].add, []);
  assert.ok(updated.customizations[ROLE_IDS.READ_ONLY].remove.includes('tickets.view'));
  assert.ok(!updated.effective[ROLE_IDS.READ_ONLY].includes('tickets.view'));
  assert.ok(updated.effective[ROLE_IDS.ADMIN].includes('users.manage'));
  assert.ok(!Object.prototype.hasOwnProperty.call(updated.customizations, ROLE_IDS.DEVELOPER));

  const reloaded = await getRoleMatrix(admin);
  assert.deepEqual(reloaded.effective[ROLE_IDS.READ_ONLY], []);
  assert.ok(reloaded.customizations[ROLE_IDS.READ_ONLY].remove.includes('tickets.view'));
  assert.ok(!Object.prototype.hasOwnProperty.call(reloaded.customizations, ROLE_IDS.DEVELOPER));

  const effectiveOnly = await getEffectiveRoleMatrixRecord();
  assert.deepEqual(effectiveOnly[ROLE_IDS.READ_ONLY], []);
  assert.ok(effectiveOnly[ROLE_IDS.ADMIN].includes('users.manage'));
});

test('updateRoleMatrix persists custom grants and loadPermissionContextForUser returns them', async () => {
  const admin = await createUser({ email: 'admin@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;
  const grants = {
    ...baseline,
    [ROLE_IDS.DEVELOPER]: [...baseline[ROLE_IDS.DEVELOPER], 'tickets.delete'],
  };

  const updated = await updateRoleMatrix(admin, { grants });
  assert.ok(updated.effective[ROLE_IDS.DEVELOPER].includes('tickets.delete'));

  const context = await loadPermissionContextForUser(admin._id);
  assert.ok(context.roleMatrix[ROLE_IDS.DEVELOPER].includes('tickets.delete'));
});

test('updateRoleMatrix partial payload preserves existing customizations for other roles', async () => {
  const admin = await createUser({ email: 'admin-partial@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;

  await updateRoleMatrix(admin, {
    grants: {
      [ROLE_IDS.DEVELOPER]: [...baseline[ROLE_IDS.DEVELOPER], 'tickets.delete'],
    },
  });

  const updated = await updateRoleMatrix(admin, {
    grants: {
      [ROLE_IDS.PROJECT_ADMIN]: [...baseline[ROLE_IDS.PROJECT_ADMIN], 'tickets.delete'],
    },
  });

  assert.ok(
    updated.effective[ROLE_IDS.DEVELOPER].includes('tickets.delete'),
    'developer customization must survive a partial update to another role',
  );
  assert.ok(updated.effective[ROLE_IDS.PROJECT_ADMIN].includes('tickets.delete'));
});

test('updateRoleMatrix rejects stripping admin safety permissions', async () => {
  const admin = await createUser({ email: 'admin2@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;
  const unsafe = {
    ...baseline,
    [ROLE_IDS.ADMIN]: baseline[ROLE_IDS.ADMIN].filter((p) => p !== 'users.manage'),
  };

  await assert.rejects(
    () => updateRoleMatrix(admin, { grants: unsafe }),
    (err) => err instanceof ApiError && err.code === 'MATRIX_SAFETY_VIOLATION',
  );
});

test('user overrides apply allow/deny on top of role baseline', async () => {
  const admin = await createUser({ email: 'admin3@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev@example.com', roles: [ROLE_IDS.DEVELOPER] });

  const withAllow = await updateUserPermissionOverrides(admin, developer._id, {
    overrides: { 'tickets.delete': 'allow' },
  });
  assert.ok(withAllow.effective.includes('tickets.delete'));

  const withDeny = await updateUserPermissionOverrides(admin, developer._id, {
    overrides: { 'tickets.create': 'deny' },
  });
  assert.ok(!withDeny.effective.includes('tickets.create'));

  const loaded = await getUserPermissionOverrides(admin, developer._id);
  assert.equal(loaded.overrides['tickets.create'], 'deny');
});

test('cannot override own permissions or super admin accounts', async () => {
  const admin = await createUser({ email: 'admin4@example.com', roles: [ROLE_IDS.ADMIN] });
  const superAdmin = await createUser({ email: 'root@example.com', roles: [ROLE_IDS.SUPER_ADMIN] });

  await assert.rejects(
    () => updateUserPermissionOverrides(admin, admin._id, { overrides: { 'tickets.delete': 'allow' } }),
    (err) => err instanceof ApiError && err.code === 'CANNOT_OVERRIDE_SELF',
  );

  await assert.rejects(
    () => updateUserPermissionOverrides(admin, superAdmin._id, { overrides: { 'tickets.delete': 'allow' } }),
    (err) => err instanceof ApiError && err.code === 'USER_NOT_FOUND',
  );
});

test('clearing overrides removes stored document', async () => {
  const admin = await createUser({ email: 'admin5@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev2@example.com', roles: [ROLE_IDS.DEVELOPER] });

  await updateUserPermissionOverrides(admin, developer._id, {
    overrides: { 'tickets.delete': 'allow' },
  });
  const cleared = await updateUserPermissionOverrides(admin, developer._id, { overrides: {} });
  assert.deepEqual(cleared.overrides, {});
  assert.equal(cleared.updatedAt, null);
});

test('loadPermissionContextForUser includes scoped assignments in parallel load', async () => {
  const admin = await createUser({ email: 'admin6@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev3@example.com', roles: [ROLE_IDS.DEVELOPER] });

  const contextBefore = await loadPermissionContextForUser(developer._id);
  assert.deepEqual(contextBefore.scopedAssignments, []);

  const { default: AccessAssignment } = await import('../../access/accessAssignment.model.js');
  const { default: Client } = await import('../../clients/client.model.js');
  const client = await Client.create({ name: 'Scope Co', status: 'active', createdBy: admin._id });
  await AccessAssignment.create({
    user: developer._id,
    role: ROLE_IDS.DEVELOPER,
    client: client._id,
    grantedBy: admin._id,
    environments: ['Staging'],
    reason: 'Scoped delivery',
  });

  const contextAfter = await loadPermissionContextForUser(developer._id);
  assert.equal(contextAfter.scopedAssignments.length, 1);
  assert.equal(contextAfter.scopedAssignments[0].role, ROLE_IDS.DEVELOPER);
});

test('updateRoleMatrix rejects non-admin escalation at service layer', async () => {
  const admin = await createUser({ email: 'admin-matrix-guard@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-matrix@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const baseline = (await getRoleMatrix(admin)).effective;

  await assert.rejects(
    () => updateRoleMatrix(developer, {
      grants: {
        [ROLE_IDS.DEVELOPER]: [...baseline[ROLE_IDS.DEVELOPER], 'users.manage'],
      },
    }),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );
});

test('updateRoleMatrix rejects stale ifMatch with deterministic conflict', async () => {
  const admin = await createUser({ email: 'admin-ifmatch@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;
  const matrix = await getRoleMatrix(admin);
  const stale = new Date(Date.now() - 60_000).toISOString();

  await assert.rejects(
    () => updateRoleMatrix(admin, {
      grants: {
        [ROLE_IDS.DEVELOPER]: [...baseline[ROLE_IDS.DEVELOPER], 'tickets.delete'],
      },
      ifMatch: stale,
    }),
    (err) => err instanceof ApiError && err.code === 'POLICY_CONFLICT',
  );

  const updated = await updateRoleMatrix(admin, {
    grants: {
      [ROLE_IDS.DEVELOPER]: [...baseline[ROLE_IDS.DEVELOPER], 'tickets.delete'],
    },
    ifMatch: matrix.updatedAt,
  });
  assert.ok(updated.effective[ROLE_IDS.DEVELOPER].includes('tickets.delete'));
});

test('updateUserPermissionOverrides rejects stale ifMatch with deterministic conflict', async () => {
  const admin = await createUser({ email: 'admin-ifmatch2@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-ifmatch@example.com', roles: [ROLE_IDS.DEVELOPER] });

  const first = await updateUserPermissionOverrides(admin, developer._id, {
    overrides: { 'tickets.delete': 'allow' },
  });
  const stale = new Date(Date.now() - 60_000).toISOString();

  await assert.rejects(
    () => updateUserPermissionOverrides(admin, developer._id, {
      overrides: { 'tickets.create': 'deny' },
      ifMatch: stale,
    }),
    (err) => err instanceof ApiError && err.code === 'POLICY_CONFLICT',
  );

  const second = await updateUserPermissionOverrides(admin, developer._id, {
    overrides: { 'tickets.create': 'deny' },
    ifMatch: first.updatedAt,
  });
  assert.equal(second.overrides['tickets.create'], 'deny');
});

test('updateUserPermissionOverrides rejects non-editable permission escalation', async () => {
  const admin = await createUser({ email: 'admin-override@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-override@example.com', roles: [ROLE_IDS.DEVELOPER] });

  await assert.rejects(
    () => updateUserPermissionOverrides(admin, developer._id, {
      overrides: { 'audit.view': 'allow' },
    }),
    (err) => /not overrideable/i.test(err.message),
  );
});

test('save matching baseline omits the role key from customizations', async () => {
  const admin = await createUser({ email: 'admin-noop-baseline@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;

  const saved = await updateRoleMatrix(admin, {
    grants: { [ROLE_IDS.READ_ONLY]: [...baseline[ROLE_IDS.READ_ONLY]] },
  });
  assert.equal(saved.customizations, null);
  assert.ok(!Object.prototype.hasOwnProperty.call(saved.customizations || {}, ROLE_IDS.READ_ONLY));
  assert.ok(saved.effective[ROLE_IDS.READ_ONLY].includes('tickets.view'));
});

test('grant CREATE on untouched read_only stores only that role', async () => {
  const admin = await createUser({ email: 'admin-create-only@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;

  const updated = await updateRoleMatrix(admin, {
    grants: {
      ...baseline,
      [ROLE_IDS.READ_ONLY]: [...baseline[ROLE_IDS.READ_ONLY], 'tickets.create'],
    },
  });

  assert.deepEqual(Object.keys(updated.customizations), [ROLE_IDS.READ_ONLY]);
  assert.deepEqual(updated.customizations[ROLE_IDS.READ_ONLY], { add: ['tickets.create'], remove: [] });
  assert.ok(updated.effective[ROLE_IDS.READ_ONLY].includes('tickets.create'));
  assert.ok(!Object.prototype.hasOwnProperty.call(updated.customizations, ROLE_IDS.DEVELOPER));
});

test('explicitly removing baseline VIEW stores a removal and does not inherit VIEW back', async () => {
  const admin = await createUser({ email: 'admin-remove-view@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;
  const withoutView = baseline[ROLE_IDS.READ_ONLY].filter((permission) => permission !== 'tickets.view');

  const updated = await updateRoleMatrix(admin, {
    grants: { [ROLE_IDS.READ_ONLY]: withoutView },
  });

  assert.deepEqual(updated.customizations[ROLE_IDS.READ_ONLY], { add: [], remove: ['tickets.view'] });
  assert.ok(!updated.effective[ROLE_IDS.READ_ONLY].includes('tickets.view'));

  const reloaded = await getRoleMatrix(admin);
  assert.ok(!reloaded.effective[ROLE_IDS.READ_ONLY].includes('tickets.view'));
  assert.deepEqual(reloaded.customizations[ROLE_IDS.READ_ONLY].remove, ['tickets.view']);
});

test('delta-customized role inherits later baseline perms unless removed; untouched roles inherit', async () => {
  const admin = await createUser({ email: 'admin-future-baseline@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;

  await updateRoleMatrix(admin, {
    grants: {
      [ROLE_IDS.DEVELOPER]: [...baseline[ROLE_IDS.DEVELOPER], 'tickets.delete'],
    },
  });
  const stored = (await getRoleMatrix(admin)).customizations;

  const expanded = {
    ...ROLE_PERMISSIONS,
    [ROLE_IDS.READ_ONLY]: [...ROLE_PERMISSIONS[ROLE_IDS.READ_ONLY], 'tickets.accept'],
    [ROLE_IDS.DEVELOPER]: [...ROLE_PERMISSIONS[ROLE_IDS.DEVELOPER], 'tickets.accept'],
  };
  const future = mergeRoleMatrixWithBaseline(stored, expanded);

  assert.ok(future[ROLE_IDS.READ_ONLY].includes('tickets.accept'));
  assert.ok(future[ROLE_IDS.DEVELOPER].includes('tickets.accept'));
  assert.ok(future[ROLE_IDS.DEVELOPER].includes('tickets.delete'));

  const blocked = mergeRoleMatrixWithBaseline({
    ...stored,
    [ROLE_IDS.DEVELOPER]: { add: ['tickets.delete'], remove: ['tickets.accept'] },
  }, expanded);
  assert.ok(!blocked[ROLE_IDS.DEVELOPER].includes('tickets.accept'));
});

test('partial PUT does not wipe sibling role customizations', async () => {
  const admin = await createUser({ email: 'admin-sibling@example.com', roles: [ROLE_IDS.ADMIN] });
  const baseline = (await getRoleMatrix(admin)).effective;

  await updateRoleMatrix(admin, {
    grants: { [ROLE_IDS.DEVELOPER]: [...baseline[ROLE_IDS.DEVELOPER], 'tickets.delete'] },
  });
  const updated = await updateRoleMatrix(admin, {
    grants: { [ROLE_IDS.TESTER]: [...baseline[ROLE_IDS.TESTER], 'tickets.delete'] },
  });

  assert.ok(Object.prototype.hasOwnProperty.call(updated.customizations, ROLE_IDS.DEVELOPER));
  assert.ok(Object.prototype.hasOwnProperty.call(updated.customizations, ROLE_IDS.TESTER));
  assert.deepEqual(updated.customizations[ROLE_IDS.DEVELOPER], {
    add: ['tickets.delete'],
    remove: [],
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(updated.customizations, ROLE_IDS.READ_ONLY));
});

test('legacy empty read_only array still means deny-all', async () => {
  const admin = await createUser({ email: 'admin-legacy-empty@example.com', roles: [ROLE_IDS.ADMIN] });
  await RoleMatrix.create({
    key: 'active',
    grants: new Map([[ROLE_IDS.READ_ONLY, []]]),
    updatedBy: admin._id,
  });

  const matrix = await getRoleMatrix(admin);
  assert.deepEqual(matrix.effective[ROLE_IDS.READ_ONLY], []);
  assert.deepEqual(matrix.customizations[ROLE_IDS.READ_ONLY], []);
  assert.ok(!matrix.effective[ROLE_IDS.READ_ONLY].includes('tickets.view'));
  assert.ok(matrix.effective[ROLE_IDS.ADMIN].includes('users.manage'));
});

test('legacy explicit read_only grant list is treated as a full replacement', async () => {
  const admin = await createUser({ email: 'admin-legacy-list@example.com', roles: [ROLE_IDS.ADMIN] });
  await RoleMatrix.create({
    key: 'active',
    grants: new Map([[ROLE_IDS.READ_ONLY, ['tickets.view']]]),
    updatedBy: admin._id,
  });

  const matrix = await getRoleMatrix(admin);
  assert.deepEqual(matrix.effective[ROLE_IDS.READ_ONLY], ['tickets.view']);
  assert.deepEqual(matrix.customizations[ROLE_IDS.READ_ONLY], ['tickets.view']);
  assert.ok(!matrix.effective[ROLE_IDS.READ_ONLY].includes('clients.view'));
});

