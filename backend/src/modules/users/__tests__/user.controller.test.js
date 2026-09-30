import assert from 'node:assert/strict';
import test from 'node:test';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import { ApiError } from '../../../platform/errors.js';
import User from '../user.model.js';
import { create, resendInvite } from '../user.controller.js';
import { TransactionalEmailDeliveryError } from '../../notifications/email.service.js';

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

async function makeAdmin() {
  return User.create({
    name: 'Admin',
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.ADMIN,
    roles: [ROLE_IDS.ADMIN],
  });
}

test('create surfaces invite delivery failure with durable log reference', async () => {
  const admin = await makeAdmin();
  const email = `new-${Date.now()}@example.com`;
  const handler = create(async () => {
    throw new TransactionalEmailDeliveryError('smtp down', { logId: 'log-create-1' });
  });

  const req = {
    user: admin,
    body: { email, role: ROLE_IDS.DEVELOPER },
    id: 'req-create-1',
  };
  const res = mockRes();
  let nextErr;
  await handler(req, res, (err) => { nextErr = err; });

  assert.ok(nextErr instanceof ApiError);
  assert.equal(nextErr.code, 'EMAIL_DELIVERY_FAILED');
  assert.equal(nextErr.statusCode, 502);
  assert.match(nextErr.message, /queued for retry as log-create-1/);
  assert.ok(await User.exists({ email }));
});

test('resendInvite surfaces delivery failure for operators', async () => {
  const admin = await makeAdmin();
  const invited = await User.create({
    name: '',
    email: `invited-${Date.now()}@example.com`,
    password: 'a-long-enough-password',
    status: 'invited',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const handler = resendInvite(async () => {
    throw new TransactionalEmailDeliveryError('smtp down', { logId: 'log-resend-1' });
  });

  const req = {
    user: admin,
    params: { id: String(invited._id) },
    id: 'req-resend-1',
  };
  const res = mockRes();
  let nextErr;
  await handler(req, res, (err) => { nextErr = err; });

  assert.ok(nextErr instanceof ApiError);
  assert.equal(nextErr.code, 'EMAIL_DELIVERY_FAILED');
  assert.equal(nextErr.statusCode, 502);
  assert.match(nextErr.message, /log-resend-1/);
});
