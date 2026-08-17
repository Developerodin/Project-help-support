// shared/__tests__/permissions.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSIONS, ROLE_PERMISSIONS, hasPermission, can, ROLE_IDS, ROLES, EXTERNAL_ROLES,
} from '../index.js';

test('every role maps to a subset of the permission registry', () => {
  for (const role of ROLES) {
    assert.ok(Array.isArray(ROLE_PERMISSIONS[role]), `${role} has a permission bundle`);
    for (const permission of ROLE_PERMISSIONS[role]) {
      assert.ok(PERMISSIONS.includes(permission), `${permission} (role ${role}) is a real permission`);
    }
  }
});

test('super_admin and admin hold the identical bundle — containment between them is identity-aware, not a permission difference', () => {
  assert.deepEqual([...ROLE_PERMISSIONS[ROLE_IDS.ADMIN]].sort(), [...PERMISSIONS].sort());
  assert.deepEqual(
    [...ROLE_PERMISSIONS[ROLE_IDS.SUPER_ADMIN]].sort(),
    [...ROLE_PERMISSIONS[ROLE_IDS.ADMIN]].sort(),
  );
});

test('read_only can view everything and mutate nothing', () => {
  const readOnly = ROLE_PERMISSIONS[ROLE_IDS.READ_ONLY];
  assert.ok(readOnly.every((p) => p.endsWith('.view')));
  assert.ok(readOnly.includes('tickets.view'));
  assert.ok(!readOnly.includes('tickets.create'));
  assert.ok(!readOnly.includes('tickets.update'));
  assert.ok(!readOnly.includes('tickets.delete'));
  assert.ok(!readOnly.includes('tickets.assign'));
});

test('developer, tester and support can create/update tickets but not delete, assign, or manage users/access', () => {
  for (const role of [ROLE_IDS.DEVELOPER, ROLE_IDS.TESTER, ROLE_IDS.SUPPORT]) {
    const bundle = ROLE_PERMISSIONS[role];
    assert.ok(bundle.includes('tickets.create'), `${role} can create tickets`);
    assert.ok(bundle.includes('tickets.update'), `${role} can update tickets`);
    assert.ok(!bundle.includes('tickets.delete'), `${role} cannot delete tickets`);
    assert.ok(!bundle.includes('tickets.assign'), `${role} cannot assign tickets`);
    assert.ok(!bundle.includes('users.manage'), `${role} cannot manage users`);
    assert.ok(!bundle.includes('access.grant'), `${role} cannot grant access`);
  }
});

test('project_admin can assign tickets and manage teams/projects but not delete tickets or manage users/access', () => {
  const bundle = ROLE_PERMISSIONS[ROLE_IDS.PROJECT_ADMIN];
  assert.ok(bundle.includes('tickets.assign'));
  assert.ok(bundle.includes('teams.manage'));
  assert.ok(bundle.includes('projects.manage'));
  assert.ok(!bundle.includes('tickets.delete'));
  assert.ok(!bundle.includes('users.manage'));
  assert.ok(!bundle.includes('access.grant'));
});

test('client and client_tester hold an empty bundle — default deny, not a guessed subset of internal permissions', () => {
  for (const role of EXTERNAL_ROLES) {
    assert.deepEqual(ROLE_PERMISSIONS[role], []);
  }
});

test('hasPermission looks up the bundle correctly and denies an unknown role', () => {
  assert.equal(hasPermission(ROLE_IDS.READ_ONLY, 'tickets.view'), true);
  assert.equal(hasPermission(ROLE_IDS.READ_ONLY, 'tickets.create'), false);
  assert.equal(hasPermission('not-a-real-role', 'tickets.view'), false);
});

test('can is the canonical check surface and keeps a scope parameter for future scoped auth', () => {
  assert.equal(can({ role: ROLE_IDS.DEVELOPER }, 'tickets.create', { projectId: 'p1' }), true);
  assert.equal(can({ role: ROLE_IDS.READ_ONLY }, 'tickets.create', { projectId: 'p1' }), false);
  assert.equal(can({ role: ROLE_IDS.CLIENT }, 'tickets.view', { projectId: 'p1' }), false);
  assert.equal(can(null, 'tickets.view', { projectId: 'p1' }), false);
});
