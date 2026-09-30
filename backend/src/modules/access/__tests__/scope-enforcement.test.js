import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS, buildRoleMatrix } from '@pms/shared';
import { assertCanViewProjects } from '../scope-enforcement.js';
import { ApiError } from '../../../platform/errors.js';

test('assertCanViewProjects skips external users', async () => {
  const external = { role: ROLE_IDS.CLIENT, roles: [ROLE_IDS.CLIENT] };
  await assertCanViewProjects(external, null);
});

test('assertCanViewProjects requires both clients.view and projects.view', async () => {
  const emptyCtx = { roleMatrix: null, userOverrides: {}, scopedAssignments: [] };
  const readOnly = { role: ROLE_IDS.READ_ONLY, roles: [ROLE_IDS.READ_ONLY] };
  await assertCanViewProjects(readOnly, emptyCtx);

  const roleMatrix = buildRoleMatrix();
  roleMatrix[ROLE_IDS.PROJECT_ADMIN] = new Set(
    [...roleMatrix[ROLE_IDS.PROJECT_ADMIN]].filter((permission) => permission !== 'clients.view'),
  );
  const projectAdmin = { role: ROLE_IDS.PROJECT_ADMIN, roles: [ROLE_IDS.PROJECT_ADMIN] };
  await assert.rejects(
    () => assertCanViewProjects(projectAdmin, { ...emptyCtx, roleMatrix }),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );
});
