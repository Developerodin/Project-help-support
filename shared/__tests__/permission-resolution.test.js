import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '../enums.js';
import {
  buildRoleMatrix,
  buildRoleCustomization,
  diffRoleMatrices,
  getEffectivePermissions,
  getRoleBaselinePermissions,
  getRoleBundle,
  mergeRoleMatrixWithBaseline,
  normaliseUserOverrides,
  recordToRoleMatrix,
  roleMatrixToRecord,
  userHasEffectivePermission,
} from '../permission-resolution.js';
import { ROLE_PERMISSIONS } from '../role-permission-bundles.js';

const developer = { id: 'usr_dev', roles: [ROLE_IDS.DEVELOPER] };

test('role baseline unions all assigned role bundles', () => {
  const user = { id: 'usr_1', roles: [ROLE_IDS.PROJECT_ADMIN, ROLE_IDS.DEVELOPER] };
  const baseline = getRoleBaselinePermissions(user);
  assert.ok(baseline.has('projects.manage'), 'from project admin');
  assert.ok(baseline.has('tickets.create'), 'from developer');
});

test('allow override adds a permission missing from the role bundle', () => {
  const effective = getEffectivePermissions(developer, {
    userOverrides: { 'tickets.delete': 'allow' },
  });
  assert.ok(effective.has('tickets.delete'));
});

test('deny override removes a permission present in the role bundle', () => {
  const effective = getEffectivePermissions(developer, {
    userOverrides: { 'tickets.create': 'deny' },
  });
  assert.ok(!effective.has('tickets.create'));
  assert.ok(effective.has('tickets.edit'));
});

test('deny wins when baseline grants and override denies the same permission', () => {
  const allowed = userHasEffectivePermission(developer, 'tickets.create', {
    userOverrides: { 'tickets.create': 'deny' },
  });
  assert.equal(allowed, false);
});

test('stored role matrix replaces the code baseline for that role', () => {
  const customMatrix = {
    [ROLE_IDS.DEVELOPER]: ['tickets.view'],
  };
  const baseline = getRoleBaselinePermissions(developer, mergeRoleMatrixWithBaseline(customMatrix));
  assert.ok(baseline.has('tickets.view'));
  assert.ok(!baseline.has('tickets.create'));
});

test('mergeRoleMatrixWithBaseline preserves baseline for untouched roles', () => {
  const effective = mergeRoleMatrixWithBaseline({
    [ROLE_IDS.DEVELOPER]: ['tickets.view'],
  });
  assert.ok(effective[ROLE_IDS.ADMIN].includes('users.manage'));
  assert.deepEqual(effective[ROLE_IDS.DEVELOPER], ['tickets.view']);
  assert.ok(effective[ROLE_IDS.READ_ONLY].includes('clients.view'));
});

test('mergeRoleMatrixWithBaseline allows explicit empty role customization', () => {
  const effective = mergeRoleMatrixWithBaseline({
    [ROLE_IDS.CLIENT]: [],
  });
  assert.deepEqual(effective[ROLE_IDS.CLIENT], []);
  assert.ok(effective[ROLE_IDS.ADMIN].includes('users.manage'));
});

test('A: empty stored matrix yields baseline VIEW for read_only', () => {
  const effective = mergeRoleMatrixWithBaseline({});
  assert.ok(effective[ROLE_IDS.READ_ONLY].includes('tickets.view'));
  assert.ok(effective[ROLE_IDS.READ_ONLY].includes('clients.view'));
  assert.ok(!effective[ROLE_IDS.READ_ONLY].includes('tickets.create'));
});

test('D: explicit empty read_only does not fall back to baseline', () => {
  const effective = mergeRoleMatrixWithBaseline({
    [ROLE_IDS.READ_ONLY]: [],
  });
  assert.deepEqual(effective[ROLE_IDS.READ_ONLY], []);
  assert.ok(effective[ROLE_IDS.ADMIN].includes('users.manage'));
});

test('getRoleBundle uses baseline when role key is absent', () => {
  const fromEmpty = getRoleBundle(ROLE_IDS.READ_ONLY, {});
  const fromNull = getRoleBundle(ROLE_IDS.READ_ONLY, null);
  assert.ok(fromEmpty.has('tickets.view'));
  assert.ok(fromNull.has('tickets.view'));
  assert.ok(!fromEmpty.has('tickets.create'));
});

test('getRoleBundle honors explicit empty stored grants', () => {
  const bundle = getRoleBundle(ROLE_IDS.READ_ONLY, { [ROLE_IDS.READ_ONLY]: [] });
  assert.equal(bundle.size, 0);
  assert.ok(!bundle.has('tickets.view'));
});

test('recordToRoleMatrix does not treat missing roles as empty grants', () => {
  const matrix = recordToRoleMatrix({
    [ROLE_IDS.DEVELOPER]: ['tickets.view'],
  });
  assert.ok(matrix[ROLE_IDS.READ_ONLY].has('tickets.view'));
  assert.ok(matrix[ROLE_IDS.DEVELOPER].has('tickets.view'));
  assert.ok(!matrix[ROLE_IDS.DEVELOPER].has('tickets.create'));
});

test('recordToRoleMatrix honors explicit empty grants', () => {
  const matrix = recordToRoleMatrix({
    [ROLE_IDS.READ_ONLY]: [],
  });
  assert.equal(matrix[ROLE_IDS.READ_ONLY].size, 0);
  assert.ok(matrix[ROLE_IDS.ADMIN].has('users.manage'));
});

test('diffRoleMatrices reports only changed cells', () => {
  const from = buildRoleMatrix();
  const to = buildRoleMatrix();
  to[ROLE_IDS.TESTER].add('tickets.delete');
  const changes = diffRoleMatrices(from, to);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], {
    role: ROLE_IDS.TESTER,
    permission: 'tickets.delete',
    before: false,
    after: true,
  });
});

test('normaliseUserOverrides rejects unknown permissions and states', () => {
  assert.throws(() => normaliseUserOverrides({ 'not.real': 'allow' }));
  assert.throws(() => normaliseUserOverrides({ 'tickets.create': 'maybe' }));
});

test('normaliseUserOverrides migrates legacy permission keys', () => {
  // Both old keys now mean tickets.edit, so each is checked on its own.
  assert.equal(normaliseUserOverrides({ 'tickets.assign': 'allow' })['tickets.edit'], 'allow');
  assert.equal(normaliseUserOverrides({ 'tickets.update': 'deny' })['tickets.edit'], 'deny');
});

// These keys guarded ticket stage moves, comments and attachments, never UI/QA,
// so a stored grant of them must not widen into ui_qa rights.
test('normaliseUserOverrides maps old ticket action keys to ticket permissions only', () => {
  const overrides = normaliseUserOverrides({
    'tickets.manage_stage': 'allow',
    'tickets.manage_attachments': 'deny',
  });
  // Stage moves became tickets.edit. Attachments folded into tickets.view, which
  // isn't per-user, so that stored override is dropped rather than failing the load.
  assert.deepEqual(overrides, { 'tickets.edit': 'allow' });
  assert.throws(() => normaliseUserOverrides({ 'tickets.view': 'allow' }), /not overrideable/);
});

test('recordToRoleMatrix migrates legacy permission keys', () => {
  const matrix = recordToRoleMatrix({
    [ROLE_IDS.DEVELOPER]: ['tickets.update', 'tickets.assign', 'tickets.watch'],
  });
  assert.ok(matrix[ROLE_IDS.DEVELOPER].has('tickets.edit'));
  assert.ok(matrix[ROLE_IDS.DEVELOPER].has('tickets.view'));
});

test('roleMatrixToRecord round-trips through recordToRoleMatrix', () => {
  const matrix = buildRoleMatrix();
  matrix[ROLE_IDS.SUPPORT].delete('tickets.create');
  const record = roleMatrixToRecord(matrix);
  const restored = recordToRoleMatrix(record);
  assert.equal(matrixHas(restored, ROLE_IDS.SUPPORT, 'tickets.create'), false);
});

function matrixHas(matrix, role, permission) {
  return matrix[role]?.has(permission) ?? false;
}

test('delta add/remove applies on top of the current baseline', () => {
  const effective = mergeRoleMatrixWithBaseline({
    [ROLE_IDS.READ_ONLY]: { add: ['tickets.create'], remove: ['tickets.view'] },
  });
  assert.ok(effective[ROLE_IDS.READ_ONLY].includes('tickets.create'));
  assert.ok(!effective[ROLE_IDS.READ_ONLY].includes('tickets.view'));
  assert.ok(effective[ROLE_IDS.READ_ONLY].includes('clients.view'));
  assert.ok(effective[ROLE_IDS.ADMIN].includes('users.manage'));
});

test('buildRoleCustomization returns null when desired matches baseline', () => {
  const baseline = [...(ROLE_PERMISSIONS[ROLE_IDS.READ_ONLY] || [])];
  assert.equal(buildRoleCustomization(ROLE_IDS.READ_ONLY, baseline), null);
  assert.deepEqual(
    buildRoleCustomization(ROLE_IDS.READ_ONLY, [...baseline, 'tickets.create']),
    { add: ['tickets.create'], remove: [] },
  );
});

test('untouched roles inherit a later baseline permission; deltas inherit unless removed', () => {
  const expanded = {
    ...ROLE_PERMISSIONS,
    [ROLE_IDS.READ_ONLY]: [...ROLE_PERMISSIONS[ROLE_IDS.READ_ONLY], 'tickets.accept'],
    [ROLE_IDS.DEVELOPER]: [...ROLE_PERMISSIONS[ROLE_IDS.DEVELOPER], 'tickets.accept'],
  };

  const withAdd = mergeRoleMatrixWithBaseline({
    [ROLE_IDS.DEVELOPER]: { add: ['tickets.delete'], remove: [] },
  }, expanded);
  assert.ok(withAdd[ROLE_IDS.READ_ONLY].includes('tickets.accept'), 'untouched role inherits new baseline perm');
  assert.ok(withAdd[ROLE_IDS.DEVELOPER].includes('tickets.accept'), 'add-only delta still inherits new baseline perm');
  assert.ok(withAdd[ROLE_IDS.DEVELOPER].includes('tickets.delete'));

  const withRemove = mergeRoleMatrixWithBaseline({
    [ROLE_IDS.DEVELOPER]: { add: [], remove: ['tickets.accept'] },
  }, expanded);
  assert.ok(!withRemove[ROLE_IDS.DEVELOPER].includes('tickets.accept'));

  const legacy = mergeRoleMatrixWithBaseline({
    [ROLE_IDS.DEVELOPER]: ['tickets.view', 'tickets.create'],
  }, expanded);
  assert.ok(!legacy[ROLE_IDS.DEVELOPER].includes('tickets.accept'), 'legacy replacement list does not inherit');
  assert.ok(legacy[ROLE_IDS.READ_ONLY].includes('tickets.accept'));
});

test('getRoleBundle resolves delta customizations', () => {
  const bundle = getRoleBundle(ROLE_IDS.READ_ONLY, {
    [ROLE_IDS.READ_ONLY]: { add: ['tickets.create'], remove: [] },
  });
  assert.ok(bundle.has('tickets.create'));
  assert.ok(bundle.has('tickets.view'));
});

test('legacy empty array remains deny-all for merge and getRoleBundle', () => {
  const stored = { [ROLE_IDS.READ_ONLY]: [] };
  assert.deepEqual(mergeRoleMatrixWithBaseline(stored)[ROLE_IDS.READ_ONLY], []);
  assert.equal(getRoleBundle(ROLE_IDS.READ_ONLY, stored).size, 0);
});

test('legacy explicit grant list remains a full replacement', () => {
  const stored = { [ROLE_IDS.READ_ONLY]: ['tickets.view'] };
  assert.deepEqual(mergeRoleMatrixWithBaseline(stored)[ROLE_IDS.READ_ONLY], ['tickets.view']);
  const bundle = getRoleBundle(ROLE_IDS.READ_ONLY, stored);
  assert.ok(bundle.has('tickets.view'));
  assert.ok(!bundle.has('clients.view'));
});

