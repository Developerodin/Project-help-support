import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES, ROLE_IDS, INTERNAL_ROLES, EXTERNAL_ROLES, PEOPLE_ASSIGNABLE_ROLES,
} from '@pms/shared';

test('the shared workspace package resolves from backend', () => {
  assert.ok(Array.isArray(ROLES), 'ROLES should be an array');
  assert.ok(ROLES.includes(ROLE_IDS.ADMIN), 'ROLES should include admin');
  assert.equal(ROLES.length, 9);
  assert.deepEqual([...ROLES], [...INTERNAL_ROLES, ...EXTERNAL_ROLES]);
  assert.ok(PEOPLE_ASSIGNABLE_ROLES.includes(ROLE_IDS.CLIENT));
  assert.ok(PEOPLE_ASSIGNABLE_ROLES.includes(ROLE_IDS.CLIENT_TESTER));
});

test('shared enums are frozen so a consumer cannot mutate them', () => {
  assert.throws(() => {
    ROLES.push('superuser');
  }, TypeError);
});
