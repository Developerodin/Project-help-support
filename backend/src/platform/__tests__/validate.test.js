import test from 'node:test';
import assert from 'node:assert/strict';
import Joi from 'joi';
import { validate } from '../validate.js';

const schema = {
  body: Joi.object({
    email: Joi.string().email().required(),
    age: Joi.number().min(18),
  }),
};

function run(req) {
  return new Promise((resolve) => validate(schema)(req, {}, (err) => resolve(err)));
}

test('passes a valid body through and replaces it with the converted value', async () => {
  const req = { body: { email: 'a@x.com', age: '30' } };
  assert.equal(await run(req), undefined);
  assert.equal(req.body.age, 30, 'Joi conversion should be applied');
});

test('maps Joi output to a flat field map', async () => {
  const err = await run({ body: { age: 12 } });
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.equal(typeof err.fields.email, 'string');
  assert.equal(typeof err.fields.age, 'string');
});

test('does not leak raw Joi internals into the response fields', async () => {
  const err = await run({ body: { age: 12 } });
  for (const value of Object.values(err.fields)) {
    assert.equal(typeof value, 'string');
    assert.ok(!value.includes('"'), 'Joi quotes its labels; strip them');
  }
});

test('rejects unknown keys rather than silently accepting them', async () => {
  const err = await run({ body: { email: 'a@x.com', role: 'admin' } });
  assert.equal(err.statusCode, 400);
  assert.ok(err.fields.role, 'an unexpected key must be reported, not ignored');
});
