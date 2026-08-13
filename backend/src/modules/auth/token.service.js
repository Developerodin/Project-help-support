import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import User, { MAX_REFRESH_TOKENS } from '../users/user.model.js';
import { ApiError } from '../../platform/errors.js';

/** Raw tokens are never persisted — only this digest. Same rule as invite tokens. */
export function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex');
}

export function generateAccessToken(user, config) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    config.jwt.secret,
    { expiresIn: `${config.jwt.accessExpirationMinutes}m` },
  );
}

export function verifyAccessToken(token, config) {
  return jwt.verify(token, config.jwt.secret);
}

export async function issueRefreshToken(user, config, meta = {}) {
  const raw = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + config.jwt.refreshExpirationDays * 86400000);

  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        refreshTokens: {
          $each: [{
            tokenHash: hashToken(raw),
            expiresAt,
            createdAt: new Date(),
            userAgent: meta.userAgent,
            ip: meta.ip,
          }],
          // Negative $slice keeps the tail — the most recent N.
          $slice: -MAX_REFRESH_TOKENS,
        },
      },
    },
  );

  return { raw, expiresAt };
}

const invalid = () => new ApiError(
  401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired',
);

/**
 * Rotation: the presented token is consumed and a new one issued.
 *
 * A token found in `consumedRefreshTokens` is being presented a second time,
 * which is a replay or a theft. Refusing only this request is not enough — the
 * holder may have others — so every session for that user is revoked.
 */
export async function rotateRefreshToken(presentedRaw, config, meta = {}) {
  const tokenHash = hashToken(presentedRaw);

  const replayed = await User.findOne({ 'consumedRefreshTokens.tokenHash': tokenHash })
    .select('+consumedRefreshTokens');
  if (replayed) {
    await revokeAllRefreshTokens(replayed._id);
    throw invalid();
  }

  const user = await User.findOne({ 'refreshTokens.tokenHash': tokenHash })
    .select('+refreshTokens +consumedRefreshTokens');
  if (!user) throw invalid();

  const entry = user.refreshTokens.find((t) => t.tokenHash === tokenHash);
  if (!entry || entry.expiresAt.getTime() <= Date.now()) {
    await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: { tokenHash } } });
    throw invalid();
  }

  if (user.status !== 'active') throw invalid();

  await User.updateOne(
    { _id: user._id },
    {
      $pull: { refreshTokens: { tokenHash } },
      $push: {
        consumedRefreshTokens: {
          $each: [{ tokenHash, consumedAt: new Date() }],
          $slice: -50,
        },
      },
    },
  );

  const issued = await issueRefreshToken(user, config, meta);
  return { user, ...issued };
}

export async function revokeRefreshToken(presentedRaw) {
  const tokenHash = hashToken(presentedRaw);
  await User.updateOne(
    { 'refreshTokens.tokenHash': tokenHash },
    { $pull: { refreshTokens: { tokenHash } } },
  );
}

export async function revokeAllRefreshTokens(userId) {
  await User.updateOne(
    { _id: userId },
    { $set: { refreshTokens: [], consumedRefreshTokens: [] } },
  );
}
