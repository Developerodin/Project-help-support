import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import { hashToken } from '../token.service.js';
import {
  login, refresh, logout, createInvite, acceptInvite,
  requestPasswordReset, resetPassword, INVITE_TTL_HOURS,
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
const admin = { role: 'admin' };

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
    name: 'Grace', email: 'Grace@Example.com', role: 'developer',
  });

  assert.ok(inviteToken.length >= 32);
  assert.equal(user.email, 'grace@example.com');
  assert.equal(user.status, 'invited');
  assert.equal(user.role, 'developer');

  const stored = await User.findById(user.id).select('+inviteTokenHash +inviteTokenExpiresAt');
  assert.equal(stored.inviteTokenHash, hashToken(inviteToken));
  assert.notEqual(stored.inviteTokenHash, inviteToken);

  const hoursOut = (stored.inviteTokenExpiresAt - Date.now()) / 3600000;
  assert.ok(hoursOut > INVITE_TTL_HOURS - 1 && hoursOut <= INVITE_TTL_HOURS);
});

test('createInvite rejects a duplicate email', async () => {
  await createInvite(admin, { name: 'Grace', email: 'grace@example.com', role: 'member' });
  const err = await createInvite(admin, { name: 'Grace 2', email: 'GRACE@example.com', role: 'member' })
    .catch((e) => e);
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'EMAIL_TAKEN');
});

test('acceptInvite activates the user, sets the password and consumes the token', async () => {
  const { inviteToken } = await createInvite(admin, {
    name: 'Grace', email: 'grace@example.com', role: 'qa',
  });

  const user = await acceptInvite(inviteToken, 'a-brand-new-password');
  assert.equal(user.status, 'active');

  const stored = await User.findById(user.id).select('+password +inviteTokenHash');
  assert.equal(stored.inviteTokenHash, undefined);
  assert.equal(await stored.isPasswordMatch('a-brand-new-password'), true);
});

test('an invite token is single-use', async () => {
  const { inviteToken } = await createInvite(admin, {
    name: 'Grace', email: 'grace@example.com', role: 'member',
  });
  await acceptInvite(inviteToken, 'a-brand-new-password');
  await assert.rejects(
    () => acceptInvite(inviteToken, 'another-password'),
    (e) => e.code === 'INVALID_INVITE',
  );
});

test('an expired invite token is refused', async () => {
  const { user, inviteToken } = await createInvite(admin, {
    name: 'Grace', email: 'grace@example.com', role: 'member',
  });
  await User.updateOne(
    { _id: user.id },
    { $set: { inviteTokenExpiresAt: new Date(Date.now() - 1000) } },
  );
  await assert.rejects(
    () => acceptInvite(inviteToken, 'another-password'),
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
