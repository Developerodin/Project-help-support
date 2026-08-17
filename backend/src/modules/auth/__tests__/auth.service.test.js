import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import { hashToken, verifyAccessToken } from '../token.service.js';
import {
  login, refresh, logout, createInvite, previewInvite, acceptInvite,
  requestPasswordReset, resetPassword, INVITE_TTL_HOURS,
  impersonate, stopImpersonation,
} from '../auth.service.js';

withMemoryDb();

const config = {
  jwt: {
    secret: 'a-sufficiently-long-test-secret-value-here',
    accessExpirationMinutes: 15,
    refreshExpirationDays: 30,
  },
};
const meta = { userAgent: 'test', ip: '127.0.0.1' };
const admin = { role: ROLE_IDS.ADMIN };

const activeUser = () => User.create({
  name: 'Ada', email: 'ada@example.com', password: 'correct-horse-battery', status: 'active',
});

test('login returns tokens and stamps lastLoginAt', async () => {
  const user = await activeUser();
  const result = await login('ada@example.com', 'correct-horse-battery', config, meta);

  assert.ok(result.accessToken);
  assert.ok(result.refreshToken);
  assert.equal(result.user.id, user._id.toString());

  const reloaded = await User.findById(user._id);
  assert.ok(reloaded.lastLoginAt instanceof Date);
});

test('login is case-insensitive on email', async () => {
  await activeUser();
  const result = await login('  ADA@Example.COM ', 'correct-horse-battery', config, meta);
  assert.ok(result.accessToken);
});

test('login rejects a wrong password with the same error as an unknown email', async () => {
  await activeUser();
  const wrongPassword = await login('ada@example.com', 'nope', config, meta).catch((e) => e);
  const unknownEmail = await login('nobody@example.com', 'nope', config, meta).catch((e) => e);

  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(unknownEmail.statusCode, 401);
  assert.equal(wrongPassword.code, unknownEmail.code);
  assert.equal(wrongPassword.message, unknownEmail.message);
});

test('login refuses an invited user who has not accepted yet', async () => {
  await User.create({
    name: 'B', email: 'b@example.com', password: 'placeholder-password', status: 'invited',
  });
  const err = await login('b@example.com', 'placeholder-password', config, meta).catch((e) => e);
  assert.equal(err.statusCode, 401);
});

test('login refuses an inactive user', async () => {
  await User.create({
    name: 'C', email: 'c@example.com', password: 'some-password-value', status: 'inactive',
  });
  const err = await login('c@example.com', 'some-password-value', config, meta).catch((e) => e);
  assert.equal(err.statusCode, 401);
});

test('refresh rotates and the old token stops working', async () => {
  await activeUser();
  const first = await login('ada@example.com', 'correct-horse-battery', config, meta);
  const second = await refresh(first.refreshToken, config, meta);

  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.ok(second.accessToken);
  await assert.rejects(() => refresh(first.refreshToken, config, meta));
});

test('logout invalidates the presented refresh token only', async () => {
  await activeUser();
  const a = await login('ada@example.com', 'correct-horse-battery', config, meta);
  const b = await login('ada@example.com', 'correct-horse-battery', config, meta);

  await logout(a.refreshToken);

  await assert.rejects(() => refresh(a.refreshToken, config, meta));
  const stillWorks = await refresh(b.refreshToken, config, meta);
  assert.ok(stillWorks.accessToken);
});

test('createInvite stores only the token hash and returns the raw token once', async () => {
  const { user, inviteToken } = await createInvite(admin, {
    email: 'Grace@Example.com', role: 'developer',
  });

  assert.ok(inviteToken.length >= 32);
  assert.equal(user.email, 'grace@example.com');
  assert.equal(user.name, '');
  assert.equal(user.status, 'invited');
  assert.equal(user.role, 'developer');

  const stored = await User.findById(user.id).select('+inviteTokenHash +inviteTokenExpiresAt');
  assert.equal(stored.inviteTokenHash, hashToken(inviteToken));
  assert.notEqual(stored.inviteTokenHash, inviteToken);

  const hoursOut = (stored.inviteTokenExpiresAt - Date.now()) / 3600000;
  assert.ok(hoursOut > INVITE_TTL_HOURS - 1 && hoursOut <= INVITE_TTL_HOURS);
});

test('createInvite defaults to read_only when no role is given', async () => {
  const { user } = await createInvite(admin, { email: 'plain@example.com' });
  assert.equal(user.role, ROLE_IDS.READ_ONLY);
});

test('createInvite rejects a duplicate invited email', async () => {
  await createInvite(admin, { email: 'grace@example.com', role: ROLE_IDS.DEVELOPER });
  const err = await createInvite(admin, { email: 'GRACE@example.com', role: ROLE_IDS.DEVELOPER })
    .catch((e) => e);
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'INVITE_PENDING');
});

test('createInvite rejects an active user email', async () => {
  await activeUser();
  const err = await createInvite(admin, { email: 'ada@example.com', role: ROLE_IDS.DEVELOPER })
    .catch((e) => e);
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'EMAIL_TAKEN');
});

test('createInvite rejects an inactive user email with a distinct error', async () => {
  await User.create({
    name: 'Former', email: 'former@example.com', password: 'some-password-value', status: 'inactive',
  });
  const err = await createInvite(admin, { email: 'former@example.com', role: ROLE_IDS.DEVELOPER })
    .catch((e) => e);
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'USER_INACTIVE');
  assert.match(err.message, /deactivated/i);
});

test('previewInvite returns the invite email from the token', async () => {
  const { inviteToken } = await createInvite(admin, { email: 'grace@example.com', role: ROLE_IDS.TESTER });
  const preview = await previewInvite(inviteToken);
  assert.equal(preview.email, 'grace@example.com');
});

test('acceptInvite activates the user, sets the name and password and consumes the token', async () => {
  const { inviteToken } = await createInvite(admin, {
    email: 'grace@example.com', role: ROLE_IDS.TESTER,
  });

  const user = await acceptInvite(inviteToken, 'Grace Hopper', 'a-brand-new-password');
  assert.equal(user.status, 'active');
  assert.equal(user.name, 'Grace Hopper');

  const stored = await User.findById(user.id).select('+password +inviteTokenHash');
  assert.equal(stored.inviteTokenHash, undefined);
  assert.equal(await stored.isPasswordMatch('a-brand-new-password'), true);
});

test('an invite token is single-use', async () => {
  const { inviteToken } = await createInvite(admin, {
    email: 'grace@example.com', role: ROLE_IDS.DEVELOPER,
  });
  await acceptInvite(inviteToken, 'Grace Hopper', 'a-brand-new-password');
  await assert.rejects(
    () => acceptInvite(inviteToken, 'Grace Hopper', 'another-password'),
    (e) => e.code === 'INVALID_INVITE',
  );
});

test('an expired invite token is refused', async () => {
  const { user, inviteToken } = await createInvite(admin, {
    email: 'grace@example.com', role: ROLE_IDS.DEVELOPER,
  });
  await User.updateOne(
    { _id: user.id },
    { $set: { inviteTokenExpiresAt: new Date(Date.now() - 1000) } },
  );
  await assert.rejects(
    () => acceptInvite(inviteToken, 'Grace Hopper', 'another-password'),
    (e) => e.code === 'INVALID_INVITE',
  );
});

test('requestPasswordReset returns null for an unknown email rather than throwing', async () => {
  assert.equal(await requestPasswordReset('nobody@example.com'), null);
});

test('requestPasswordReset issues a token for a known active user', async () => {
  await activeUser();
  const result = await requestPasswordReset('ada@example.com');
  assert.ok(result.resetToken);

  const stored = await User.findById(result.user.id).select('+inviteTokenHash');
  assert.equal(stored.inviteTokenHash, hashToken(result.resetToken));
});

test('resetPassword sets the new password and revokes every existing session', async () => {
  await activeUser();
  const session = await login('ada@example.com', 'correct-horse-battery', config, meta);
  const { resetToken } = await requestPasswordReset('ada@example.com');

  await resetPassword(resetToken, 'a-totally-new-password');

  await assert.rejects(() => refresh(session.refreshToken, config, meta), 'old session must die');
  const ok = await login('ada@example.com', 'a-totally-new-password', config, meta);
  assert.ok(ok.accessToken);
});

const adminUser = () => User.create({
  name: 'Admin', email: 'admin@example.com', password: 'admin-password-value', status: 'active', role: ROLE_IDS.ADMIN,
});
const superAdminUser = () => User.create({
  name: 'Root', email: 'root@example.com', password: 'root-password-value', status: 'active', role: ROLE_IDS.SUPER_ADMIN,
});
const targetUser = () => User.create({
  name: 'Target', email: 'target@example.com', password: 'target-password-value', status: 'active', role: ROLE_IDS.DEVELOPER,
});

test('impersonate issues a session for the target carrying the impersonatedBy claim', async () => {
  const admin = await adminUser();
  const target = await targetUser();
  const adminSession = await login('admin@example.com', 'admin-password-value', config, meta);

  const result = await impersonate(admin, target._id, adminSession.refreshToken, config, meta);

  assert.equal(result.user.id, target._id.toString());
  assert.equal(result.impersonation.by, admin._id.toString());

  const payload = verifyAccessToken(result.accessToken, config);
  assert.equal(payload.sub, target._id.toString());
  assert.equal(payload.impersonatedBy, admin._id.toString());
});

test('impersonate rejects impersonating yourself', async () => {
  const admin = await adminUser();
  const adminSession = await login('admin@example.com', 'admin-password-value', config, meta);

  const err = await impersonate(admin, admin._id, adminSession.refreshToken, config, meta)
    .catch((e) => e);
  assert.equal(err.code, 'CANNOT_IMPERSONATE_SELF');
});

test('impersonate rejects an Admin impersonating another Admin', async () => {
  const admin = await adminUser();
  const otherAdmin = await User.create({
    name: 'Other', email: 'other-admin@example.com', password: 'other-password-value',
    status: 'active', role: ROLE_IDS.ADMIN,
  });
  const adminSession = await login('admin@example.com', 'admin-password-value', config, meta);

  const err = await impersonate(admin, otherAdmin._id, adminSession.refreshToken, config, meta)
    .catch((e) => e);
  assert.equal(err.statusCode, 403);
  assert.equal(err.code, 'CANNOT_IMPERSONATE_PEER');
});

test('impersonate rejects a Super Admin target regardless of who is asking', async () => {
  const admin = await adminUser();
  const superAdmin = await superAdminUser();
  const adminSession = await login('admin@example.com', 'admin-password-value', config, meta);

  const err = await impersonate(admin, superAdmin._id, adminSession.refreshToken, config, meta)
    .catch((e) => e);
  assert.equal(err.statusCode, 403);
  assert.equal(err.code, 'SUPER_ADMIN_PROTECTED');
});

test('impersonate rejects even when the ACTOR is a Super Admin targeting another Super Admin', async () => {
  const actingSuperAdmin = await superAdminUser();
  const otherSuperAdmin = await User.create({
    name: 'Root Two', email: 'root2@example.com', password: 'root2-password-value',
    status: 'active', role: ROLE_IDS.SUPER_ADMIN,
  });
  const session = await login('root@example.com', 'root-password-value', config, meta);

  const err = await impersonate(actingSuperAdmin, otherSuperAdmin._id, session.refreshToken, config, meta)
    .catch((e) => e);
  assert.equal(err.code, 'SUPER_ADMIN_PROTECTED');
});

test('impersonate allows a Super Admin actor to impersonate an Admin', async () => {
  const superAdmin = await superAdminUser();
  const admin = await adminUser();
  const session = await login('root@example.com', 'root-password-value', config, meta);

  const result = await impersonate(superAdmin, admin._id, session.refreshToken, config, meta);
  assert.equal(result.user.id, admin._id.toString());
});

test('impersonate rejects an inactive target', async () => {
  const admin = await adminUser();
  const target = await User.create({
    name: 'Gone', email: 'gone@example.com', password: 'gone-password-value', status: 'inactive',
  });
  const adminSession = await login('admin@example.com', 'admin-password-value', config, meta);

  const err = await impersonate(admin, target._id, adminSession.refreshToken, config, meta)
    .catch((e) => e);
  assert.equal(err.code, 'USER_NOT_ACTIVE');
});

test('impersonate rejects a stale or invalid admin refresh token', async () => {
  const admin = await adminUser();
  const target = await targetUser();

  const err = await impersonate(admin, target._id, 'not-a-real-refresh-token', config, meta)
    .catch((e) => e);
  assert.equal(err.code, 'INVALID_REFRESH_TOKEN');
});

test('stopImpersonation restores the admin session and ends impersonation', async () => {
  const admin = await adminUser();
  const target = await targetUser();
  const adminSession = await login('admin@example.com', 'admin-password-value', config, meta);
  const impersonated = await impersonate(admin, target._id, adminSession.refreshToken, config, meta);

  const result = await stopImpersonation(
    impersonated.refreshToken, impersonated.adminRefreshToken, config, meta,
  );

  assert.equal(result.user.id, admin._id.toString());
  const payload = verifyAccessToken(result.accessToken, config);
  assert.equal(payload.sub, admin._id.toString());
  assert.equal(payload.impersonatedBy, undefined);
});

test('stopImpersonation revokes the impersonated session so it cannot be reused', async () => {
  const admin = await adminUser();
  const target = await targetUser();
  const adminSession = await login('admin@example.com', 'admin-password-value', config, meta);
  const impersonated = await impersonate(admin, target._id, adminSession.refreshToken, config, meta);

  await stopImpersonation(impersonated.refreshToken, impersonated.adminRefreshToken, config, meta);

  await assert.rejects(() => refresh(impersonated.refreshToken, config, meta));
});
