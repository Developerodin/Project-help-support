import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User, { MAX_REFRESH_TOKENS } from '../user.model.js';

withMemoryDb();

const valid = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct-horse-battery' };

test('normalises email by trimming and lowercasing', async () => {
  const user = await User.create({ ...valid, email: '  Ada@EXAMPLE.com  ' });
  assert.equal(user.email, 'ada@example.com');
});

test('rejects a duplicate email that differs only by case or whitespace', async () => {
  await User.init();
  await User.create(valid);
  await assert.rejects(
    () => User.create({ ...valid, email: ' ADA@Example.COM ' }),
    (err) => err.code === 11000,
  );
});

test('hashes the password and never stores the plaintext', async () => {
  const user = await User.create(valid);
  assert.notEqual(user.password, valid.password);
  assert.ok(user.password.startsWith('$2'), 'should be a bcrypt hash');
  assert.equal(await user.isPasswordMatch(valid.password), true);
  assert.equal(await user.isPasswordMatch('wrong'), false);
});

test('does not re-hash the password when an unrelated field changes', async () => {
  const user = await User.create(valid);
  const firstHash = user.password;
  user.name = 'Ada King';
  await user.save();
  assert.equal(user.password, firstHash);
  assert.equal(await user.isPasswordMatch(valid.password), true);
});

test('password, invite hash and refresh tokens are excluded from queries by default', async () => {
  await User.create(valid);
  const fetched = await User.findOne({ email: valid.email });
  assert.equal(fetched.password, undefined);
  assert.equal(fetched.inviteTokenHash, undefined);
  assert.equal(fetched.refreshTokens, undefined);
});

test('toJSON exposes id and hides every secret', async () => {
  const user = await User.create({ ...valid, inviteTokenHash: 'deadbeef' });
  const json = user.toJSON();
  assert.equal(json.id, user._id.toString());
  assert.equal(json._id, undefined);
  assert.equal(json.password, undefined);
  assert.equal(json.inviteTokenHash, undefined);
  assert.equal(json.refreshTokens, undefined);
});

test('defaults are role=read_only, kind=internal, status=invited', async () => {
  const user = await User.create(valid);
  assert.equal(user.role, ROLE_IDS.READ_ONLY);
  assert.equal(user.kind, 'internal');
  assert.equal(user.status, 'invited');
});

test('an invited user may be created without a name', async () => {
  const user = await User.create({ email: 'pending@example.com', password: 'placeholder-password' });
  assert.equal(user.name, '');
  assert.equal(user.status, 'invited');
});

test('rejects a role outside the shared ROLES enum', async () => {
  await assert.rejects(() => User.create({ ...valid, role: 'superuser' }), /role/);
});

test('seeds notification preferences from the shared defaults', async () => {
  const user = await User.create(valid);
  assert.equal(user.notificationPrefs.email.get('TICKET_ASSIGNED'), true);
  assert.equal(user.notificationPrefs.email.get('TICKET_COMMENTED'), false);
  assert.equal(user.notificationPrefs.inApp.get('TICKET_COMMENTED'), true);
});

test('refreshTokens is capped at the most recent MAX_REFRESH_TOKENS', async () => {
  const user = await User.create(valid);
  const fresh = await User.findById(user._id).select('+refreshTokens');
  for (let i = 0; i < MAX_REFRESH_TOKENS + 5; i += 1) {
    fresh.refreshTokens.push({
      tokenHash: `hash-${i}`,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(Date.now() + i),
    });
  }
  await fresh.save();

  const reloaded = await User.findById(user._id).select('+refreshTokens');
  assert.equal(reloaded.refreshTokens.length, MAX_REFRESH_TOKENS);
  const hashes = reloaded.refreshTokens.map((t) => t.tokenHash);
  assert.ok(hashes.includes(`hash-${MAX_REFRESH_TOKENS + 4}`), 'newest must be kept');
  assert.ok(!hashes.includes('hash-0'), 'oldest must be dropped');
});

test('isEmailTaken finds an existing address and ignores the excluded user', async () => {
  const user = await User.create(valid);
  assert.equal(await User.isEmailTaken('ADA@example.com'), true);
  assert.equal(await User.isEmailTaken('ada@example.com', user._id), false);
  assert.equal(await User.isEmailTaken('nobody@example.com'), false);
});
