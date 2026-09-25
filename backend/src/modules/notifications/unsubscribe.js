import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../platform/errors.js';
import User from '../users/user.model.js';

/**
 * One-click unsubscribe (RFC 8058) for ticket mail. The token is
 * `<version>.<userId>.<HMAC-SHA256(jwt secret, "<userId>.<purpose>")>`: it can
 * only pause or resume that one person's ticket email, so it never expires —
 * an unsubscribe link in a year-old email must still work.
 *
 * Rotation: rotating JWT_SECRET invalidates every link already sent. To move
 * to a new scheme without that, add 'v2' here and keep verifying 'v1'.
 */
const TOKEN_VERSION = 'v1';
const PURPOSE = 'email-unsubscribe';

function sign(userId, secret) {
  return createHmac('sha256', secret).update(`${userId}.${PURPOSE}`).digest('base64url');
}

export function unsubscribeToken(userId, config) {
  return `${TOKEN_VERSION}.${userId}.${sign(String(userId), config.jwt.secret)}`;
}

/** The user id the token was issued for, or null. Constant-time on the signature. */
export function verifyUnsubscribeToken(token, config) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return null;
  const [version, userId, signature] = parts;
  if (version !== TOKEN_VERSION || !/^[0-9a-f]{24}$/i.test(userId)) return null;

  const expected = Buffer.from(sign(userId, config.jwt.secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}

/**
 * Everything a ticket email needs to let its reader opt out: the footer
 * links (through the frontend, which explains what happened) and, when the
 * API's public URL is configured, the List-Unsubscribe header value mail
 * providers POST to.
 */
export function unsubscribeLinks(userId, config) {
  const manageUrl = `${config.frontendBaseUrl}/settings/notifications`;
  // Only a hand-built partial config (tests, one-off scripts) lacks the
  // secret; loadConfig requires it. No secret, nothing to sign with.
  if (!config.jwt?.secret) return { manageUrl, unsubscribeUrl: null, listUnsubscribe: null };
  const token = encodeURIComponent(unsubscribeToken(userId, config));
  return {
    manageUrl,
    unsubscribeUrl: `${config.frontendBaseUrl}/unsubscribe?token=${token}`,
    listUnsubscribe: config.apiPublicUrl
      ? `<${config.apiPublicUrl}/v1/notifications/email/unsubscribe?token=${token}>`
      : null,
  };
}

/** p***@example.com: enough for the reader to recognise their own address. */
export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

// One message for every failure, so the endpoint does not tell a caller
// which user ids exist.
const invalidLink = () => new ApiError(400, 'INVALID_UNSUBSCRIBE_LINK', 'This unsubscribe link is not valid.');

async function userForToken(token, config) {
  const userId = verifyUnsubscribeToken(token, config);
  if (!userId) throw invalidLink();
  const user = await User.findOne({ _id: userId, status: { $ne: 'deleted' } }).select('email notificationPrefs');
  if (!user) throw invalidLink();
  return user;
}

/** Read-only: link scanners prefetch GETs, so looking must never unsubscribe. */
export async function unsubscribeStatus(token, config) {
  const user = await userForToken(token, config);
  return { email: maskEmail(user.email), paused: user.notificationPrefs?.emailPaused === true };
}

export async function setEmailPaused(token, config, paused) {
  const user = await userForToken(token, config);
  await User.updateOne({ _id: user._id }, { $set: { 'notificationPrefs.emailPaused': paused } });
}
