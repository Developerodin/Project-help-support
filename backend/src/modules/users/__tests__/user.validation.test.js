import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { createUserSchema, updateUserSchema } from '../user.validation.js';

function validate(schema, body) {
  return schema.body.validate(body);
}

test('createUserSchema rejects a roles array mixing an internal and an external role', () => {
  const { error } = validate(createUserSchema, {
    email: 'a@example.com',
    roles: [ROLE_IDS.DEVELOPER, ROLE_IDS.CLIENT],
  });
  assert.ok(error, 'expected a validation error');
  assert.match(error.message, /Roles cannot mix internal and external types/);
});

test('createUserSchema accepts an all-internal roles array', () => {
  const { error } = validate(createUserSchema, {
    email: 'a@example.com',
    roles: [ROLE_IDS.DEVELOPER, ROLE_IDS.TESTER],
  });
  assert.equal(error, undefined);
});

test('createUserSchema accepts an all-external roles array', () => {
  const { error } = validate(createUserSchema, {
    email: 'a@example.com',
    roles: [ROLE_IDS.CLIENT_TESTER],
  });
  assert.equal(error, undefined);
});

test('updateUserSchema rejects a roles array mixing an internal and an external role', () => {
  const { error } = validate(updateUserSchema, {
    roles: [ROLE_IDS.PROJECT_ADMIN, ROLE_IDS.CLIENT],
  });
  assert.ok(error, 'expected a validation error');
  assert.match(error.message, /Roles cannot mix internal and external types/);
});

test('updateUserSchema accepts an all-internal roles array', () => {
  const { error } = validate(updateUserSchema, {
    roles: [ROLE_IDS.ADMIN],
  });
  assert.equal(error, undefined);
});
