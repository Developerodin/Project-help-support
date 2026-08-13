import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from './helpers/memoryDb.js';
import User from '../../modules/users/user.model.js';
import { generateAccessToken } from '../../modules/auth/token.service.js';
import { auth, requireRole } from '../auth.js';

withMemoryDb();

const config = {
  jwt: { secret: 'a-sufficiently-long-test-secret-value-here', accessExpirationMinutes: 15 },
};

let counter = 0;
const makeUser = (over = {}) => {
  counter += 1;
  return User.create({
    name: 'Ada',
    email: `ada-${counter}@example.com`,
    password: 'correct-horse-battery',
    status: 'active',
    ...over,
  });
};

function run(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (err) => resolve(err));
  });
}

test('accepts a valid token and attaches the user document', async () => {
  const user = await makeUser({ role: 'lead' });
  const req = { headers: { authorization: `Bearer ${generateAccessToken(user, config)}` } };

  const err = await run(auth(config), req);
  assert.equal(err, undefined);
  assert.equal(req.user._id.toString(), user._id.toString());
  assert.equal(req.user.role, 'lead');
});

test('rejects a missing Authorization header with 401', async () => {
  const err = await run(auth(config), { headers: {} });
  assert.equal(err.statusCode, 401);
  assert.equal(err.code, 'UNAUTHENTICATED');
});

test('rejects a malformed header with 401', async () => {
  const err = await run(auth(config), { headers: { authorization: 'Token abc' } });
  assert.equal(err.statusCode, 401);
});

test('rejects a token signed with the wrong secret', async () => {
  const user = await makeUser();
  const bad = generateAccessToken(user, {
    jwt: { ...config.jwt, secret: 'a-completely-different-secret-value' },
  });
  const err = await run(auth(config), { headers: { authorization: `Bearer ${bad}` } });
  assert.equal(err.statusCode, 401);
});

test('rejects a token whose user no longer exists', async () => {
  const user = await makeUser();
  const token = generateAccessToken(user, config);
  await User.deleteOne({ _id: user._id });
  const err = await run(auth(config), { headers: { authorization: `Bearer ${token}` } });
  assert.equal(err.statusCode, 401);
});

test('rejects an invited user — before any role or resource check runs', async () => {
  const user = await makeUser({ status: 'invited' });
  const err = await run(auth(config), {
    headers: { authorization: `Bearer ${generateAccessToken(user, config)}` },
  });
  assert.equal(err.statusCode, 401);
});

test('rejects an inactive user', async () => {
  const user = await makeUser({ status: 'inactive' });
  const err = await run(auth(config), {
    headers: { authorization: `Bearer ${generateAccessToken(user, config)}` },
  });
  assert.equal(err.statusCode, 401);
});

test('reads the role from the database, not from the token', async () => {
  const user = await makeUser({ role: 'member' });
  const token = generateAccessToken(user, config);
  await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });

  const req = { headers: { authorization: `Bearer ${token}` } };
  await run(auth(config), req);
  assert.equal(req.user.role, 'admin', 'a stale token must not pin an old role');
});

test('requireRole allows a listed role', async () => {
  const err = await run(requireRole('admin', 'lead'), { user: { role: 'lead' } });
  assert.equal(err, undefined);
});

test('requireRole rejects an unlisted role with 403, never 404', async () => {
  const err = await run(requireRole('admin'), { user: { role: 'member' } });
  assert.equal(err.statusCode, 403);
  assert.equal(err.code, 'FORBIDDEN');
});

test('requireRole rejects with 401 when there is no authenticated user', async () => {
  const err = await run(requireRole('admin'), {});
  assert.equal(err.statusCode, 401);
});
