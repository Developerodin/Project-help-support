import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import { ApiError } from '../../../platform/errors.js';
import {
  impersonate,
  stopImpersonation,
  login,
  logout,
  refresh,
  requestPasswordReset,
  resetPassword,
} from '../auth.service.js';
import { hashToken } from '../token.service.js';

withMemoryDb();

const config = {
  jwt: {
    secret: 'a-sufficiently-long-test-secret-value-here',
    accessExpirationMinutes: 15,
    refreshExpirationDays: 7,
  },
};

const meta = { userAgent: 'test', ip: '127.0.0.1' };

let counter = 0;
async function makeUser(roles, over = {}) {
  counter += 1;
  const roleList = Array.isArray(roles) ? roles : [roles];
  return User.create({
    name: `User ${counter}`,
    email: `user-${counter}@example.com`,
    password: 'correct-horse-battery',
    roles: roleList,
    role: roleList[0],
    status: 'active',
    ...over,
  });
}

async function adminSession(user) {
  return login(user.email, 'correct-horse-battery', config, meta);
}

test('impersonate issues a session for the target carrying the impersonatedBy claim', async () => {
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const target = await makeUser(ROLE_IDS.DEVELOPER);
  const session = await adminSession(admin);

  const result = await impersonate(admin, target._id, session.refreshToken, config, meta);

  assert.equal(result.user.id, target._id.toString());
  assert.equal(result.impersonation.by, admin._id.toString());

  const payload = jwt.verify(result.accessToken, config.jwt.secret);
  assert.equal(payload.impersonatedBy, admin._id.toString());
  assert.deepEqual(payload.roles, [ROLE_IDS.DEVELOPER]);
});

test('impersonate rejects impersonating yourself', async () => {
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const session = await adminSession(admin);

  await assert.rejects(
    () => impersonate(admin, admin._id, session.refreshToken, config, meta),
    (err) => err instanceof ApiError && err.code === 'CANNOT_IMPERSONATE_SELF',
  );
});

test('impersonate rejects inactive targets', async () => {
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const target = await makeUser(ROLE_IDS.DEVELOPER, { status: 'inactive' });
  const session = await adminSession(admin);

  await assert.rejects(
    () => impersonate(admin, target._id, session.refreshToken, config, meta),
    (err) => err instanceof ApiError && err.code === 'USER_NOT_ACTIVE',
  );
});

test('impersonate rejects super admin targets', async () => {
  const admin = await makeUser(ROLE_IDS.SUPER_ADMIN);
  const target = await makeUser(ROLE_IDS.SUPER_ADMIN);
  const session = await adminSession(admin);

  await assert.rejects(
    () => impersonate(admin, target._id, session.refreshToken, config, meta),
    (err) => err instanceof ApiError && err.code === 'SUPER_ADMIN_PROTECTED',
  );
});

test('impersonate rejects admin impersonating admin peers', async () => {
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const peer = await makeUser(ROLE_IDS.ADMIN);
  const session = await adminSession(admin);

  await assert.rejects(
    () => impersonate(admin, peer._id, session.refreshToken, config, meta),
    (err) => err instanceof ApiError && err.code === 'CANNOT_IMPERSONATE_PEER',
  );
});

test('impersonate rejects admin impersonating multi-role admin+developer targets', async () => {
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const peer = await makeUser([ROLE_IDS.ADMIN, ROLE_IDS.DEVELOPER]);
  const session = await adminSession(admin);

  await assert.rejects(
    () => impersonate(admin, peer._id, session.refreshToken, config, meta),
    (err) => err instanceof ApiError && err.code === 'CANNOT_IMPERSONATE_PEER',
  );
});

test('super admin may impersonate admin targets', async () => {
  const superAdmin = await makeUser(ROLE_IDS.SUPER_ADMIN);
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const session = await adminSession(superAdmin);

  const result = await impersonate(superAdmin, admin._id, session.refreshToken, config, meta);
  assert.equal(result.user.id, admin._id.toString());
});

test('impersonate allows external client and client_tester targets', async () => {
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const client = await makeUser(ROLE_IDS.CLIENT);
  const clientTester = await makeUser(ROLE_IDS.CLIENT_TESTER);
  const session = await adminSession(admin);

  const clientResult = await impersonate(admin, client._id, session.refreshToken, config, meta);
  assert.equal(clientResult.user.id, client._id.toString());
  assert.equal(clientResult.impersonation.by, admin._id.toString());

  const testerResult = await impersonate(admin, clientTester._id, session.refreshToken, config, meta);
  assert.equal(testerResult.user.id, clientTester._id.toString());
  assert.equal(testerResult.impersonation.by, admin._id.toString());
});

test('impersonate rejects project admin initiators even with multi-role elevation', async () => {
  const initiator = await makeUser([ROLE_IDS.PROJECT_ADMIN, ROLE_IDS.DEVELOPER]);
  const target = await makeUser(ROLE_IDS.DEVELOPER);
  const session = await adminSession(initiator);

  await assert.rejects(
    () => impersonate(initiator, target._id, session.refreshToken, config, meta),
    (err) => err instanceof ApiError && err.code === 'NOT_IMPERSONATION_INITIATOR',
  );
});

test('impersonate allows admin to impersonate project admin targets', async () => {
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const projectAdmin = await makeUser(ROLE_IDS.PROJECT_ADMIN);
  const session = await adminSession(admin);

  const result = await impersonate(admin, projectAdmin._id, session.refreshToken, config, meta);
  assert.equal(result.user.id, projectAdmin._id.toString());
});

test('impersonate rejects missing targets', async () => {
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const session = await adminSession(admin);
  const missingId = '507f1f77bcf86cd799439011';

  await assert.rejects(
    () => impersonate(admin, missingId, session.refreshToken, config, meta),
    (err) => err instanceof ApiError && err.code === 'USER_NOT_FOUND',
  );
});

test('impersonate rejects invalid admin refresh token', async () => {
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const target = await makeUser(ROLE_IDS.DEVELOPER);

  await assert.rejects(
    () => impersonate(admin, target._id, 'not-a-real-refresh-token', config, meta),
    (err) => err instanceof ApiError && err.code === 'INVALID_REFRESH_TOKEN',
  );
});

test('stopImpersonation restores the admin session', async () => {
  const admin = await makeUser(ROLE_IDS.ADMIN);
  const target = await makeUser(ROLE_IDS.DEVELOPER);
  const session = await adminSession(admin);

  const started = await impersonate(admin, target._id, session.refreshToken, config, meta);
  const restored = await stopImpersonation(
    started.refreshToken,
    started.adminRefreshToken,
    config,
    meta,
  );

  assert.equal(restored.user.id, admin._id.toString());
  const payload = jwt.verify(restored.accessToken, config.jwt.secret);
  assert.equal(payload.impersonatedBy, undefined);
});

test('resetPassword refuses a deactivated account, even with a live token', async () => {
  const user = await makeUser(ROLE_IDS.DEVELOPER);
  const reset = await requestPasswordReset(user.email);
  await User.updateOne({ _id: user._id }, { $set: { status: 'inactive' } });

  await assert.rejects(
    () => resetPassword(reset.resetToken, 'a-brand-new-password'),
    (err) => err instanceof ApiError && err.code === 'INVALID_INVITE',
  );
  assert.equal((await User.findById(user._id)).status, 'inactive');
});

test('resetPassword refuses an invited account: invites are accepted, not reset', async () => {
  const user = await makeUser(ROLE_IDS.DEVELOPER, { status: 'invited' });
  const raw = 'invite-token-raw';
  await User.updateOne({ _id: user._id }, {
    $set: { inviteTokenHash: hashToken(raw), inviteTokenExpiresAt: new Date(Date.now() + 3600000) },
  });

  await assert.rejects(
    () => resetPassword(raw, 'a-brand-new-password'),
    (err) => err instanceof ApiError && err.code === 'INVALID_INVITE',
  );
  assert.equal((await User.findById(user._id)).status, 'invited');
});

test('resetPassword still works for an active account', async () => {
  const user = await makeUser(ROLE_IDS.DEVELOPER);
  const reset = await requestPasswordReset(user.email);

  await resetPassword(reset.resetToken, 'a-brand-new-password');
  const session = await login(user.email, 'a-brand-new-password', config, meta);
  assert.ok(session.accessToken);
});

test('K: logout revokes the refresh token so a later refresh fails', async () => {
  const user = await makeUser(ROLE_IDS.DEVELOPER);
  const session = await login(user.email, 'correct-horse-battery', config, meta);

  await logout(session.refreshToken);

  await assert.rejects(
    () => refresh(session.refreshToken, config, meta),
    (err) => err instanceof ApiError && err.code === 'INVALID_REFRESH_TOKEN',
  );
});
