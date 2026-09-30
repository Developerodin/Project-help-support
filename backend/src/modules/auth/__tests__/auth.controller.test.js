import assert from 'node:assert/strict';
import test from 'node:test';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import { refreshCookieOptions, forgotPassword } from '../auth.controller.js';

const expiresAt = new Date('2030-01-01T00:00:00.000Z');
withMemoryDb();

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('refreshCookieOptions uses strict cookie policy from config', () => {
  const options = refreshCookieOptions({
    cookie: {
      secure: true,
      sameSite: 'strict',
      domain: '.example.com',
    },
  }, expiresAt);

  assert.deepEqual(options, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    domain: '.example.com',
    path: '/v1/auth',
    expires: expiresAt,
  });
});

test('refreshCookieOptions uses embed-mode SameSite=None policy from config', () => {
  const options = refreshCookieOptions({
    cookie: {
      secure: true,
      sameSite: 'none',
      domain: undefined,
    },
  }, expiresAt);

  assert.equal(options.sameSite, 'none');
  assert.equal(options.secure, true);
  assert.equal(options.httpOnly, true);
  assert.equal(options.path, '/v1/auth');
});

test('forgotPassword keeps anti-enumeration response and requests non-throw delivery mode', async () => {
  const account = await User.create({
    name: 'Ada',
    email: `ada-${Date.now()}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
  });
  let calledOptions = null;
  const deliver = async (_result, options = {}) => {
    calledOptions = options;
    return { sent: false, queued: true };
  };

  const req = { body: { email: account.email }, id: 'req-forgot-1' };
  const res = mockRes();
  let nextErr;
  await forgotPassword(deliver)(req, res, (err) => { nextErr = err; });

  assert.equal(nextErr, undefined);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: 'If that email is registered, a reset link has been sent.' });
  assert.deepEqual(calledOptions, { throwOnError: false, requestId: 'req-forgot-1' });
});

test('forgotPassword responds without waiting on delivery, and a delivery failure is swallowed', async () => {
  const account = await User.create({
    name: 'Ada',
    email: `ada-slow-${Date.now()}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
  });
  let release;
  const deliver = () => new Promise((_resolve, reject) => { release = reject; });

  const req = { body: { email: account.email }, id: 'req-forgot-3' };
  const res = mockRes();
  let nextErr;
  await forgotPassword(deliver)(req, res, (err) => { nextErr = err; });

  assert.equal(nextErr, undefined);
  assert.equal(res.statusCode, 200, 'responded while delivery is still in flight');
  release(new Error('SMTP down'));
  await new Promise((r) => setImmediate(r));
});

test('forgotPassword response is identical for unknown addresses', async () => {
  const req = { body: { email: `missing-${Date.now()}@example.com` }, id: 'req-forgot-2' };
  const res = mockRes();
  let delivered = false;
  let nextErr;
  await forgotPassword(async () => { delivered = true; })(req, res, (err) => { nextErr = err; });

  assert.equal(nextErr, undefined);
  assert.equal(delivered, false);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: 'If that email is registered, a reset link has been sent.' });
});
