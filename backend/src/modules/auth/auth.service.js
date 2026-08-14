import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import User from '../users/user.model.js';
import { ApiError } from '../../platform/errors.js';
import {
  hashToken, generateAccessToken, issueRefreshToken,
  rotateRefreshToken, revokeRefreshToken, revokeAllRefreshTokens,
} from './token.service.js';

export const INVITE_TTL_HOURS = 72;
const RESET_TTL_HOURS = 2;

/** A real bcrypt hash of a value nobody knows, for the timing-equalising compare below. */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

/**
 * One error for "no such email" and "wrong password" alike. Distinguishing them
 * turns the login form into an account-existence oracle.
 */
const badCredentials = () => new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
const badInvite = () => new ApiError(
  400, 'INVALID_INVITE', 'This invitation link is invalid or has expired',
);

function newRawToken() {
  return randomBytes(32).toString('hex');
}

async function issueSession(user, config, meta) {
  const { raw, expiresAt } = await issueRefreshToken(user, config, meta);
  return {
    user: user.toJSON(),
    accessToken: generateAccessToken(user, config),
    refreshToken: raw,
    refreshExpiresAt: expiresAt,
  };
}

export async function login(email, password, config, meta = {}) {
  const normalised = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalised }).select('+password');

  if (!user) {
    // Compare against a real hash so a miss costs roughly what a wrong password
    // costs. Without this the response time distinguishes the two.
    await bcrypt.compare(password, DUMMY_HASH);
    throw badCredentials();
  }

  if (!(await user.isPasswordMatch(password))) throw badCredentials();
  if (user.status !== 'active') throw badCredentials();

  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  return issueSession(user, config, meta);
}

export async function refresh(presentedRaw, config, meta = {}) {
  const { user, raw, expiresAt } = await rotateRefreshToken(presentedRaw, config, meta);
  return {
    user: user.toJSON(),
    accessToken: generateAccessToken(user, config),
    refreshToken: raw,
    refreshExpiresAt: expiresAt,
  };
}

export async function logout(presentedRaw) {
  if (presentedRaw) await revokeRefreshToken(presentedRaw);
}

export async function createInvite(_actor, { email, role = 'member' }) {
  const existing = await User.findByNormalisedEmail(email);
  if (existing) {
    if (existing.status === 'inactive') {
      throw new ApiError(
        400,
        'USER_INACTIVE',
        'This user was deactivated. Reactivate them or delete the account before inviting again.',
      );
    }
    if (existing.status === 'invited') {
      throw new ApiError(
        400,
        'INVITE_PENDING',
        'An invite is already pending for this email. Resend it from the People list.',
      );
    }
    throw new ApiError(400, 'EMAIL_TAKEN', 'A user with that email is already active.');
  }

  const inviteToken = newRawToken();
  const user = await User.create({
    email,
    role,
    status: 'invited',
    // A random placeholder the invitee never learns; acceptInvite replaces it.
    password: newRawToken(),
    inviteTokenHash: hashToken(inviteToken),
    inviteTokenExpiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600000),
  });

  return { user: user.toJSON(), inviteToken };
}

export async function previewInvite(rawToken) {
  const user = await User.findOne({ inviteTokenHash: hashToken(rawToken) })
    .select('+inviteTokenHash +inviteTokenExpiresAt');

  if (!user) throw badInvite();
  if (user.status !== 'invited') throw badInvite();
  if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt.getTime() <= Date.now()) {
    throw badInvite();
  }

  return { email: user.email };
}

export async function acceptInvite(rawToken, name, password) {
  const user = await User.findOne({ inviteTokenHash: hashToken(rawToken) })
    .select('+inviteTokenHash +inviteTokenExpiresAt +password');

  if (!user) throw badInvite();
  if (user.status !== 'invited') throw badInvite();
  if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt.getTime() <= Date.now()) {
    throw badInvite();
  }

  user.name = String(name).trim();
  user.password = password;
  user.status = 'active';
  // Single use: clearing the hash is what makes a replay fail the lookup above.
  user.inviteTokenHash = undefined;
  user.inviteTokenExpiresAt = undefined;
  await user.save();

  return user.toJSON();
}

/**
 * Returns null for an unknown or non-active email. The CALLER must respond
 * identically in both cases — see auth.controller.js.
 */
export async function requestPasswordReset(email) {
  const normalised = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalised });
  if (!user || user.status !== 'active') return null;

  const resetToken = newRawToken();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        inviteTokenHash: hashToken(resetToken),
        inviteTokenExpiresAt: new Date(Date.now() + RESET_TTL_HOURS * 3600000),
      },
    },
  );

  return { user: user.toJSON(), resetToken };
}

export async function resetPassword(rawToken, newPassword) {
  const user = await User.findOne({ inviteTokenHash: hashToken(rawToken) })
    .select('+inviteTokenHash +inviteTokenExpiresAt +password');

  if (!user) throw badInvite();
  if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt.getTime() <= Date.now()) {
    throw badInvite();
  }

  user.password = newPassword;
  user.status = 'active';
  user.inviteTokenHash = undefined;
  user.inviteTokenExpiresAt = undefined;
  await user.save();

  // A password change ends every existing session — that is the point of one.
  await revokeAllRefreshTokens(user._id);
}

/**
 * Mints a fresh invite token for a user who is still `invited`. Reuses the same
 * hashed-token fields as createInvite, so an old link stops working the moment
 * a new one is issued.
 */
export async function reissueInvite(userId) {
  const inviteToken = newRawToken();

  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        inviteTokenHash: hashToken(inviteToken),
        inviteTokenExpiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600000),
      },
    },
    { new: true },
  );

  return { user: user.toJSON(), inviteToken };
}