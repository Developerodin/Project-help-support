// shared/__tests__/enums.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_IDS, ROLES, INTERNAL_ROLES, EXTERNAL_ROLES, ROLE_LABELS,
  ADMIN_ROLES, IMPERSONATION_INITIATOR_ROLES, PROJECT_ADMIN_ROLES,
  SEVERITIES, PRIORITIES, CATEGORIES, LABELS, ENVIRONMENTS, LINK_RELS, STAGE_DECISIONS,
} from '../enums.js';

const ALL = {
  ROLES, INTERNAL_ROLES, EXTERNAL_ROLES, ADMIN_ROLES, IMPERSONATION_INITIATOR_ROLES, PROJECT_ADMIN_ROLES,
  SEVERITIES, PRIORITIES, CATEGORIES, LABELS, ENVIRONMENTS, LINK_RELS, STAGE_DECISIONS,
};

test('every enum is a frozen array of unique non-empty strings', () => {
  for (const [name, values] of Object.entries(ALL)) {
    assert.ok(Array.isArray(values), `${name} should be an array`);
    assert.ok(Object.isFrozen(values), `${name} should be frozen`);
    assert.ok(values.length > 0, `${name} should not be empty`);
    assert.equal(new Set(values).size, values.length, `${name} has duplicates`);
    for (const v of values) {
      assert.equal(typeof v, 'string', `${name} contains a non-string`);
      assert.ok(v.trim().length > 0, `${name} contains an empty string`);
    }
  }
});

test('stage decisions cover only the QA verdicts', () => {
  assert.deepEqual([...STAGE_DECISIONS], ['approved', 'rejected']);
});

test('ROLES is exactly INTERNAL_ROLES followed by EXTERNAL_ROLES, nine total', () => {
  assert.deepEqual([...ROLES], [...INTERNAL_ROLES, ...EXTERNAL_ROLES]);
  assert.equal(ROLES.length, 9);
});

test('ROLES is derived from ROLE_IDS — no role exists as a bare string anywhere else', () => {
  assert.deepEqual([...ROLES].sort(), Object.values(ROLE_IDS).sort());
});

test('EXTERNAL_ROLES holds exactly client and client_tester', () => {
  assert.deepEqual([...EXTERNAL_ROLES], [ROLE_IDS.CLIENT, ROLE_IDS.CLIENT_TESTER]);
});

test('ROLE_LABELS has a human-readable label for every one of the nine roles', () => {
  for (const role of ROLES) {
    assert.equal(typeof ROLE_LABELS[role], 'string');
    assert.ok(ROLE_LABELS[role].length > 0);
  }
  assert.equal(ROLE_LABELS[ROLE_IDS.SUPER_ADMIN], 'Super Admin');
  assert.equal(ROLE_LABELS[ROLE_IDS.READ_ONLY], 'Read Only');
  assert.equal(ROLE_LABELS[ROLE_IDS.CLIENT_TESTER], 'Client Tester');
});

test('ADMIN_ROLES and IMPERSONATION_INITIATOR_ROLES hold the same values but are distinct exports', () => {
  assert.deepEqual([...ADMIN_ROLES], [ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN]);
  assert.deepEqual([...IMPERSONATION_INITIATOR_ROLES], [ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN]);
  assert.notEqual(
    ADMIN_ROLES, IMPERSONATION_INITIATOR_ROLES,
    'must be two separate arrays, not one constant re-exported under two names',
  );
});

test('PROJECT_ADMIN_ROLES is built from ROLE_IDS, not re-typed strings', () => {
  assert.deepEqual(
    [...PROJECT_ADMIN_ROLES],
    [ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN, ROLE_IDS.PROJECT_ADMIN],
  );
});
