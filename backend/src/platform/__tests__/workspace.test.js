import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '@pms/shared';

test('the shared workspace package resolves from backend', () => {
  assert.ok(Array.isArray(ROLES), 'ROLES should be an array');
  assert.ok(ROLES.includes('admin'), 'ROLES should include admin');
  assert.equal(ROLES.length, 5);
});

test('shared enums are frozen so a consumer cannot mutate them', () => {
  assert.throws(() => {
    ROLES.push('superuser');
  }, TypeError);
});
