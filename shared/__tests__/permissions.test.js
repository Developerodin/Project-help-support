// shared/__tests__/permissions.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSIONS, ROLE_PERMISSIONS, hasPermission, can, pickPrimaryRole, ROLE_IDS, ROLES, EXTERNAL_ROLES,
  isMatrixActionSupported, isMatrixActionEditable,
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

test('unassigned grants nothing and never wins pickPrimaryRole over a real role', () => {
  assert.deepEqual([...ROLE_PERMISSIONS[ROLE_IDS.UNASSIGNED]], []);
  assert.equal(hasPermission(ROLE_IDS.UNASSIGNED, 'tickets.view'), false);
  assert.equal(pickPrimaryRole([ROLE_IDS.UNASSIGNED, ROLE_IDS.TESTER]), ROLE_IDS.TESTER);
  assert.equal(pickPrimaryRole([ROLE_IDS.UNASSIGNED]), ROLE_IDS.UNASSIGNED);
});

test('read_only can view everything and mutate nothing', () => {
  const readOnly = ROLE_PERMISSIONS[ROLE_IDS.READ_ONLY];
  // Only viewing, plus the AI assistant (which can itself only change what the role may).
  assert.ok(readOnly.every((p) => p.endsWith('.view') || p === 'assistant.use'));
  assert.ok(readOnly.includes('tickets.view'));
  assert.ok(readOnly.includes('ui_qa.view'));
  assert.ok(!readOnly.includes('tickets.create'));
  assert.ok(!readOnly.includes('tickets.edit'));
  assert.ok(!readOnly.includes('tickets.delete'));
  assert.ok(!readOnly.includes('tickets.manage_assignment'));
});

test('developer, tester and support can create/edit tickets but not delete, assign, or manage users/access', () => {
  for (const role of [ROLE_IDS.DEVELOPER, ROLE_IDS.TESTER, ROLE_IDS.SUPPORT]) {
    const bundle = ROLE_PERMISSIONS[role];
    assert.ok(bundle.includes('tickets.create'), `${role} can create tickets`);
    assert.ok(bundle.includes('tickets.edit'), `${role} can edit tickets`);
    assert.ok(bundle.includes('ui_qa.edit'), `${role} can edit UI & QA`);
    assert.ok(!bundle.includes('tickets.delete'), `${role} cannot delete tickets`);
    assert.ok(!bundle.includes('ui_qa.delete'), `${role} cannot delete UI & QA attachments`);
    assert.ok(!bundle.includes('tickets.manage_assignment'), `${role} cannot assign tickets`);
    assert.ok(!bundle.includes('users.manage'), `${role} cannot manage users`);
    assert.ok(!bundle.includes('access.grant'), `${role} cannot grant access`);
  }
});

test('project_admin can edit tickets (including assignment) and manage teams/projects but not delete tickets or manage users/access', () => {
  const bundle = ROLE_PERMISSIONS[ROLE_IDS.PROJECT_ADMIN];
  assert.ok(bundle.includes('tickets.edit'));
  assert.ok(bundle.includes('teams.create'));
  assert.ok(bundle.includes('teams.edit'));
  assert.ok(bundle.includes('teams.delete'));
  assert.ok(bundle.includes('projects.manage'));
  assert.ok(!bundle.includes('tickets.delete'));
  assert.ok(!bundle.includes('users.manage'));
  assert.ok(!bundle.includes('access.grant'));
});

test('client and client_tester hold no data permissions — default deny; only the switchable AI assistant', () => {
  for (const role of EXTERNAL_ROLES) {
    assert.deepEqual(ROLE_PERMISSIONS[role], ['assistant.use']);
  }
});

test('hasPermission looks up the bundle correctly and denies an unknown role', () => {
  assert.equal(hasPermission(ROLE_IDS.READ_ONLY, 'tickets.view'), true);
  assert.equal(hasPermission(ROLE_IDS.READ_ONLY, 'tickets.create'), false);
  assert.equal(hasPermission('not-a-real-role', 'tickets.view'), false);
});

test('can uses effective permissions when override context is supplied', () => {
  const user = { role: ROLE_IDS.DEVELOPER, roles: [ROLE_IDS.DEVELOPER] };
  assert.equal(can(user, 'tickets.delete', { userOverrides: { 'tickets.delete': 'allow' } }), true);
  assert.equal(can(user, 'tickets.create', { userOverrides: { 'tickets.create': 'deny' } }), false);
});

test('external roles can configure ticket matrix cells', () => {
  assert.equal(isMatrixActionSupported(ROLE_IDS.CLIENT, ['tickets.view']), true);
  assert.equal(isMatrixActionSupported(ROLE_IDS.DEVELOPER, ['tickets.view']), true);
  assert.equal(isMatrixActionEditable(ROLE_IDS.CLIENT, ['tickets.create'], true), true);
  assert.equal(isMatrixActionEditable(ROLE_IDS.DEVELOPER, ['tickets.create'], true), true);
  assert.equal(isMatrixActionSupported(ROLE_IDS.CLIENT, ['clients.view']), true);
});
