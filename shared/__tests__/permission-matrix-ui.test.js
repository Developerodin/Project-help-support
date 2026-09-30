import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '../enums.js';
import {
  isMatrixActionEditable,
  isMatrixActionSupported,
  isFeatureActionGranted,
  setFeatureActionGranted,
  EXTERNAL_ROLE_TOGGLE_PERMISSION,
  isExternalRoleToggleGranted,
  setExternalRoleToggleGranted,
  countRoleGrants,
  PERMISSION_FEATURE_MATRIX,
} from '../permission-matrix-ui.js';
import { buildRoleMatrix, matrixHasPermission } from '../permission-resolution.js';

const MATRIX_ROLES_TO_VERIFY = [
  ROLE_IDS.ADMIN,
  ROLE_IDS.DEVELOPER,
  ROLE_IDS.TESTER,
  ROLE_IDS.READ_ONLY,
  ROLE_IDS.SUPPORT,
];

test('isMatrixActionEditable is driven by editor mode, not target role label', () => {
  const keys = ['tickets.create'];
  assert.equal(isMatrixActionEditable(ROLE_IDS.READ_ONLY, keys, false), false);
  assert.equal(isMatrixActionEditable(ROLE_IDS.READ_ONLY, keys, true), true);
  assert.equal(isMatrixActionEditable(ROLE_IDS.DEVELOPER, keys, true), true);
});

test('read_only supports internal ticket permissions in the matrix', () => {
  assert.equal(isMatrixActionSupported(ROLE_IDS.READ_ONLY, ['tickets.create']), true);
  assert.equal(isMatrixActionSupported(ROLE_IDS.READ_ONLY, ['clients.manage']), true);
});

test('external roles support ticket and board matrix cells like internal roles', () => {
  assert.equal(isMatrixActionSupported(ROLE_IDS.CLIENT, ['tickets.create']), true);
  assert.equal(isMatrixActionSupported(ROLE_IDS.CLIENT, ['boards.view']), true);
  assert.equal(isMatrixActionSupported(ROLE_IDS.CLIENT, ['clients.view']), true);
  assert.equal(isMatrixActionEditable(ROLE_IDS.CLIENT, ['tickets.create'], true), true);
});

test('setFeatureActionGranted updates read_only draft grants', () => {
  const snapshot = buildRoleMatrix();
  assert.equal(isFeatureActionGranted(snapshot, ROLE_IDS.READ_ONLY, ['tickets.create']), false);

  setFeatureActionGranted(snapshot, ROLE_IDS.READ_ONLY, ['tickets.create'], true);
  assert.equal(isFeatureActionGranted(snapshot, ROLE_IDS.READ_ONLY, ['tickets.create']), true);

  setFeatureActionGranted(snapshot, ROLE_IDS.READ_ONLY, ['tickets.create'], false);
  assert.equal(isFeatureActionGranted(snapshot, ROLE_IDS.READ_ONLY, ['tickets.create']), false);
});

test('editable cell count is consistent across internal matrix roles in edit mode', () => {
  const keys = ['tickets.create'];
  for (const role of MATRIX_ROLES_TO_VERIFY) {
    assert.equal(
      isMatrixActionEditable(role, keys, true),
      isMatrixActionSupported(role, keys),
      `editability must follow support rules for ${role}`,
    );
  }
});

test('toggling Projects view grants both clients.view and projects.view', () => {
  const snapshot = buildRoleMatrix();
  const keys = ['clients.view', 'projects.view'];
  assert.equal(isFeatureActionGranted(snapshot, ROLE_IDS.CLIENT, keys), false);

  setFeatureActionGranted(snapshot, ROLE_IDS.CLIENT, keys, true);
  assert.equal(isFeatureActionGranted(snapshot, ROLE_IDS.CLIENT, keys), true);
  assert.equal(matrixHasPermission(snapshot, ROLE_IDS.CLIENT, 'clients.view'), true);
  assert.equal(matrixHasPermission(snapshot, ROLE_IDS.CLIENT, 'projects.view'), true);

  setFeatureActionGranted(snapshot, ROLE_IDS.CLIENT, keys, false);
  assert.equal(isFeatureActionGranted(snapshot, ROLE_IDS.CLIENT, keys), false);
  assert.equal(matrixHasPermission(snapshot, ROLE_IDS.CLIENT, 'clients.view'), false);
  assert.equal(matrixHasPermission(snapshot, ROLE_IDS.CLIENT, 'projects.view'), false);
});

test('UI & QA row sits between Board and Tickets with create marked unsupported', () => {
  const labels = PERMISSION_FEATURE_MATRIX.map((group) => group.label);
  const boardIndex = labels.indexOf('Board');
  const uiQaIndex = labels.indexOf('UI & QA');
  const ticketsIndex = labels.indexOf('Tickets');
  assert.ok(boardIndex >= 0);
  assert.ok(uiQaIndex > boardIndex);
  assert.ok(ticketsIndex > uiQaIndex);

  const uiQa = PERMISSION_FEATURE_MATRIX[uiQaIndex].features[0];
  assert.equal(uiQa.key, 'ui-qa');
  assert.deepEqual(uiQa.actions.view, ['ui_qa.view']);
  assert.deepEqual(uiQa.actions.create, []);
  assert.deepEqual(uiQa.actions.edit, ['ui_qa.edit']);
  assert.deepEqual(uiQa.actions.delete, ['ui_qa.delete']);
  assert.equal(isMatrixActionSupported(ROLE_IDS.DEVELOPER, uiQa.actions.create), false);
  assert.equal(isMatrixActionSupported(ROLE_IDS.DEVELOPER, uiQa.actions.view), true);
});

test('external acceptance toggle grants tickets.accept for client roles', () => {
  const snapshot = buildRoleMatrix();
  assert.equal(isExternalRoleToggleGranted(snapshot, ROLE_IDS.CLIENT, EXTERNAL_ROLE_TOGGLE_PERMISSION), false);
  assert.equal(countRoleGrants(snapshot, ROLE_IDS.CLIENT), 1, 'just the AI assistant by default');

  setExternalRoleToggleGranted(snapshot, ROLE_IDS.CLIENT, EXTERNAL_ROLE_TOGGLE_PERMISSION, true);
  assert.equal(isExternalRoleToggleGranted(snapshot, ROLE_IDS.CLIENT, EXTERNAL_ROLE_TOGGLE_PERMISSION), true);
  assert.equal(matrixHasPermission(snapshot, ROLE_IDS.CLIENT, EXTERNAL_ROLE_TOGGLE_PERMISSION), true);
  assert.equal(countRoleGrants(snapshot, ROLE_IDS.CLIENT), 2);

  setExternalRoleToggleGranted(snapshot, ROLE_IDS.CLIENT_TESTER, EXTERNAL_ROLE_TOGGLE_PERMISSION, true);
  assert.equal(countRoleGrants(snapshot, ROLE_IDS.CLIENT_TESTER), 2);
});

test('the AI assistant is a switchable row for every role below admin, and locked on for admins', () => {
  const assistantRow = PERMISSION_FEATURE_MATRIX.flatMap((group) => group.features).find((feature) => feature.key === 'assistant');
  assert.deepEqual(assistantRow.actions.view, ['assistant.use']);
  for (const role of [ROLE_IDS.PROJECT_ADMIN, ROLE_IDS.DEVELOPER, ROLE_IDS.TESTER, ROLE_IDS.SUPPORT,
    ROLE_IDS.READ_ONLY, ROLE_IDS.CLIENT, ROLE_IDS.CLIENT_TESTER]) {
    assert.equal(isMatrixActionEditable(role, assistantRow.actions.view, true), true, role);
  }
  for (const role of [ROLE_IDS.ADMIN, ROLE_IDS.SUPER_ADMIN]) {
    assert.equal(isMatrixActionEditable(role, assistantRow.actions.view, true), false, role);
  }
});
