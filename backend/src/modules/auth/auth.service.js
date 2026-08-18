import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ROLE_IDS, pickPrimaryRole, isSuperAdmin, hasAnyRole } from '@pms/shared';
import User from '../users/user.model.js';
import { ApiError } from '../../platform/errors.js';
import logger from '../../platform/logger.js';
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
  const { user, raw, expiresAt, impersonatedBy } = await rotateRefreshToken(presentedRaw, config, meta);
  const tokenOpts = impersonatedBy ? { impersonatedBy } : {};
  return {
    user: user.toJSON(),
    accessToken: generateAccessToken(user, config, tokenOpts),
    refreshToken: raw,
    refreshExpiresAt: expiresAt,
    impersonatedBy: impersonatedBy?.toString() ?? null,
  };
}

export async function logout(presentedRaw) {
  if (presentedRaw) await revokeRefreshToken(presentedRaw);
}

export async function createInvite(_actor, { email, role, roles }) {
  const resolvedRoles = roles?.length
    ? [...new Set(roles)]
    : [role || ROLE_IDS.DEVELOPER];
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
    roles: resolvedRoles,
    role: pickPrimaryRole(resolvedRoles),
    status: 'invited',
    // A random placeholder the invitee never learns; acceptInvite replaces it.
    password: newRawToken(),
    inviteTokenHash: hashToken(inviteToken),
    inviteTokenExpiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600000),
  });

  return { user: user.toJSON(), inviteToken };
}

/**
 * Starts an impersonated session for `targetId`, keeping the admin's own
 * refresh token untouched so stopImpersonation can hand it straight back to
 * rotateRefreshToken later. Gated only by requireRole('admin') on the route —
 * swap for can('users:impersonate') once the Phase 1 access-control system ships.
 */
export async function impersonate(admin, targetId, adminRefreshRaw, config, meta = {}) {
  if (String(admin._id) === String(targetId)) {
    throw new ApiError(400, 'CANNOT_IMPERSONATE_SELF', 'You are already signed in as this user');
  }

  const target = await User.findById(targetId);
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  if (target.status !== 'active') {
    throw new ApiError(400, 'USER_NOT_ACTIVE', 'Only active users can be impersonated');
  }
  if (isSuperAdmin(target)) {
    throw new ApiError(403, 'SUPER_ADMIN_PROTECTED', 'Super Admin accounts cannot be impersonated');
  }
  if (hasAnyRole(admin, ROLE_IDS.ADMIN) && hasAnyRole(target, ROLE_IDS.ADMIN)) {
    throw new ApiError(403, 'CANNOT_IMPERSONATE_PEER', 'Admins cannot impersonate other Admins');
  }

  const adminValid = await User.exists({
    _id: admin._id,
    refreshTokens: { $elemMatch: { tokenHash: hashToken(adminRefreshRaw), expiresAt: { $gt: new Date() } } },
  });
  if (!adminValid) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }

  const { raw, expiresAt } = await issueRefreshToken(target, config, { ...meta, impersonatedBy: admin._id });
  logger.info('user.impersonate.start', {
    adminId: admin._id.toString(), targetId: target._id.toString(), ip: meta.ip,
  });

  return {
    user: target.toJSON(),
    accessToken: generateAccessToken(target, config, { impersonatedBy: admin._id }),
    refreshToken: raw,
    refreshExpiresAt: expiresAt,
    adminRefreshToken: adminRefreshRaw,
    impersonation: { by: admin._id.toString(), byName: admin.name || admin.email },
  };
}

/**
 * Ends an impersonated session: revokes the target's session and rotates the
 * admin's stashed refresh token back into a normal (non-impersonated) one.
 */
export async function stopImpersonation(targetRefreshRaw, adminRefreshRaw, config, meta = {}) {
  if (!adminRefreshRaw) {
    throw new ApiError(400, 'REFRESH_REQUIRED', 'Admin session could not be restored');
  }

  if (targetRefreshRaw) await revokeRefreshToken(targetRefreshRaw);

  const { user, raw, expiresAt } = await rotateRefreshToken(adminRefreshRaw, config, meta);
  logger.info('user.impersonate.stop', { adminId: user._id.toString(), ip: meta.ip });

  return {
    user: user.toJSON(),
    accessToken: generateAccessToken(user, config),
    refreshToken: raw,
    refreshExpiresAt: expiresAt,
  };
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