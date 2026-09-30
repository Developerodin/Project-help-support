import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS, buildRoleMatrix, can, migratePermissionKeys } from '@pms/shared';
import { assertCanViewTeams } from '../scope-enforcement.js';
import { ApiError } from '../../../platform/errors.js';

test('migratePermissionKeys expands legacy teams.manage', () => {
  const migrated = migratePermissionKeys(['teams.manage']);
  assert.deepEqual(migrated.sort(), ['teams.create', 'teams.delete', 'teams.edit'].sort());
});

test('assertCanViewTeams requires teams.view for internal users', async () => {
  const emptyCtx = { roleMatrix: null, userOverrides: {}, scopedAssignments: [] };
  const readOnly = { role: ROLE_IDS.READ_ONLY, roles: [ROLE_IDS.READ_ONLY] };
  await assertCanViewTeams(readOnly, emptyCtx);

  const roleMatrix = buildRoleMatrix();
  roleMatrix[ROLE_IDS.DEVELOPER] = new Set(
    [...roleMatrix[ROLE_IDS.DEVELOPER]].filter((permission) => permission !== 'teams.view'),
  );
  const developer = { role: ROLE_IDS.DEVELOPER, roles: [ROLE_IDS.DEVELOPER] };
  await assert.rejects(
    () => assertCanViewTeams(developer, { ...emptyCtx, roleMatrix }),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );
});

test('project admin retains independent team mutation permissions', () => {
  const user = { role: ROLE_IDS.PROJECT_ADMIN, roles: [ROLE_IDS.PROJECT_ADMIN] };
  assert.equal(can(user, 'teams.view'), true);
  assert.equal(can(user, 'teams.create'), true);
  assert.equal(can(user, 'teams.edit'), true);
  assert.equal(can(user, 'teams.delete'), true);
  assert.equal(can(user, 'teams.manage'), false);
});
