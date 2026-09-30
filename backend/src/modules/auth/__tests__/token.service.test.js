import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import jwt from 'jsonwebtoken';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import {
  hashToken, generateAccessToken, verifyAccessToken,
  issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllRefreshTokens,
} from '../token.service.js';

withMemoryDb();

const config = {
  jwt: {
    secret: 'a-sufficiently-long-test-secret-value-here',
    accessExpirationMinutes: 15,
    refreshExpirationDays: 30,
  },
};
const meta = { userAgent: 'test-agent', ip: '127.0.0.1' };

const makeUser = () => User.create({
  name: 'Ada', email: 'ada@example.com', password: 'correct-horse-battery', status: 'active',
});

test('hashToken is deterministic sha256 hex and is not the input', () => {
  const h = hashToken('secret-value');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashToken('secret-value'));
  assert.notEqual(h, 'secret-value');
});

test('access token round-trips subject and role', async () => {
  const user = await makeUser();
  const payload = verifyAccessToken(generateAccessToken(user, config), config);
  assert.equal(payload.sub, user._id.toString());
  assert.equal(payload.role, ROLE_IDS.READ_ONLY);
});

test('an access token signed with a different secret does not verify', async () => {
  const user = await makeUser();
  const token = generateAccessToken(user, {
    jwt: { ...config.jwt, secret: 'another-secret-entirely-long-enough' },
  });
  assert.throws(() => verifyAccessToken(token, config));
});

test('an access token with a different algorithm does not verify, even with the right secret', async () => {
  const user = await makeUser();
  const hs512 = jwt.sign({ sub: user._id.toString() }, config.jwt.secret, { algorithm: 'HS512' });
  assert.throws(() => verifyAccessToken(hs512, config), /invalid algorithm/);
  assert.ok(verifyAccessToken(generateAccessToken(user, config), config).sub);
});

test('issueRefreshToken returns a raw token and stores only its hash', async () => {
  const user = await makeUser();
  const { raw } = await issueRefreshToken(user, config, meta);

  const stored = await User.findById(user._id).select('+refreshTokens');
  assert.equal(stored.refreshTokens.length, 1);
  assert.equal(stored.refreshTokens[0].tokenHash, hashToken(raw));
  assert.notEqual(stored.refreshTokens[0].tokenHash, raw);
  assert.equal(stored.refreshTokens[0].userAgent, 'test-agent');
});

test('rotate issues a new token and invalidates the presented one', async () => {
  const user = await makeUser();
  const first = await issueRefreshToken(user, config, meta);

  const rotated = await rotateRefreshToken(first.raw, config, meta);
  assert.notEqual(rotated.raw, first.raw);
  assert.equal(rotated.user._id.toString(), user._id.toString());

  const stored = await User.findById(user._id).select('+refreshTokens');
  const hashes = stored.refreshTokens.map((t) => t.tokenHash);
  assert.ok(hashes.includes(hashToken(rotated.raw)), 'new token stored');
  assert.ok(!hashes.includes(hashToken(first.raw)), 'presented token removed');
});

test('presenting an already-rotated token invalidates EVERY session for that user', async () => {
  const user = await makeUser();
  const first = await issueRefreshToken(user, config, meta);
  const second = await issueRefreshToken(user, config, meta);
  await rotateRefreshToken(first.raw, config, meta);
  // Past the few seconds a second tab may legitimately lag behind.
  await User.updateOne({ _id: user._id }, { $set: { 'consumedRefreshTokens.$[].consumedAt': new Date(Date.now() - 60_000) } });

  // Replay of a consumed token: theft or replay. Neither is benign.
  await assert.rejects(
    () => rotateRefreshToken(first.raw, config, meta),
    (e) => e.code === 'INVALID_REFRESH_TOKEN',
  );

  const stored = await User.findById(user._id).select('+refreshTokens');
  assert.equal(stored.refreshTokens.length, 0, 'all sessions revoked after replay');

  await assert.rejects(() => rotateRefreshToken(second.raw, config, meta));
});

test('two concurrent refreshes with one token: only one wins, the other gets a 401', async () => {
  const user = await makeUser();
  const first = await issueRefreshToken(user, config, meta);

  const results = await Promise.allSettled([
    rotateRefreshToken(first.raw, config, meta),
    rotateRefreshToken(first.raw, config, meta),
  ]);

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const loser = results.find((r) => r.status === 'rejected');
  assert.equal(loser.reason.code, 'REFRESH_TOKEN_ROTATED');
});

test('an unknown token is rejected', async () => {
  await makeUser();
  await assert.rejects(
    () => rotateRefreshToken('never-issued', config, meta),
    (e) => e.code === 'INVALID_REFRESH_TOKEN',
  );
});

test('an expired refresh token is rejected and pruned', async () => {
  const user = await makeUser();
  const { raw } = await issueRefreshToken(user, config, meta);

  await User.updateOne(
    { _id: user._id, 'refreshTokens.tokenHash': hashToken(raw) },
    { $set: { 'refreshTokens.$.expiresAt': new Date(Date.now() - 1000) } },
  );

  await assert.rejects(
    () => rotateRefreshToken(raw, config, meta),
    (e) => e.code === 'INVALID_REFRESH_TOKEN',
  );
  const stored = await User.findById(user._id).select('+refreshTokens');
  assert.equal(stored.refreshTokens.length, 0);
});

test('revokeRefreshToken removes exactly one session, leaving others intact', async () => {
  const user = await makeUser();
  const a = await issueRefreshToken(user, config, meta);
  const b = await issueRefreshToken(user, config, meta);

  await revokeRefreshToken(a.raw);

  const stored = await User.findById(user._id).select('+refreshTokens');
  const hashes = stored.refreshTokens.map((t) => t.tokenHash);
  assert.ok(!hashes.includes(hashToken(a.raw)));
  assert.ok(hashes.includes(hashToken(b.raw)));
});

test('revokeAllRefreshTokens clears live and consumed sets', async () => {
  const user = await makeUser();
  const a = await issueRefreshToken(user, config, meta);
  await issueRefreshToken(user, config, meta);
  await rotateRefreshToken(a.raw, config, meta);

  await revokeAllRefreshTokens(user._id);

  const stored = await User.findById(user._id).select('+refreshTokens +consumedRefreshTokens');
  assert.equal(stored.refreshTokens.length, 0);
  assert.equal(stored.consumedRefreshTokens.length, 0);
});

test('a second tab presenting the token another tab just rotated keeps every session', async () => {
  const user = await makeUser();
  const first = await issueRefreshToken(user, config, meta);
  const rotated = await rotateRefreshToken(first.raw, config, meta);

  await assert.rejects(
    () => rotateRefreshToken(first.raw, config, meta),
    (e) => e.statusCode === 401 && e.code === 'REFRESH_TOKEN_ROTATED',
  );
  // The winning tab's new token still works.
  await rotateRefreshToken(rotated.raw, config, meta);
});
