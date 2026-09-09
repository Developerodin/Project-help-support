import { randomBytes } from 'node:crypto';
import {
  ROLE_IDS,
  ROLES,
  NOTIFICATION_EVENTS,
  DEFAULT_TICKET_PREFERENCES,
  mergeTicketPreferences,
  defaultTicketPreferencesForUser,
  normalizeTicketPreferencesForUser,
  isSuperAdmin,
  hasAnyRole,
  pickPrimaryRole,
} from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import { revokeAllRefreshTokens, hashToken } from '../auth/token.service.js';

/** Keep in sync with auth.service.js INVITE_TTL_HOURS. */
const INVITE_TTL_HOURS = 72;
import User from './user.model.js';
import {
  NOT_SUPER_ADMIN_FILTER,
  userHasRoleQuery,
  LEGACY_GLOBAL_ROLE_MAP,
} from './user-role-query.js';

/**
 * Backfill roles[] from legacy `role` and remap pre-v2 literals (lead/qa/member).
 * Idempotent — safe on every boot.
 */
export async function migrateLegacyUserRoles() {
  const legacyLiterals = Object.keys(LEGACY_GLOBAL_ROLE_MAP);
  const candidates = await User.find({
    $or: [
      { role: { $in: legacyLiterals } },
      { roles: { $exists: false } },
      { roles: { $size: 0 } },
    ],
  }).select('role roles').lean();

  let migrated = 0;
  let skipped = 0;

  for (const user of candidates) {
    if (isSuperAdmin(user)) {
      skipped += 1;
      continue;
    }

    const mappedRole = LEGACY_GLOBAL_ROLE_MAP[user.role] ?? user.role;
    if (!ROLES.includes(mappedRole)) {
      skipped += 1;
      continue;
    }

    if (
      user.roles?.length === 1
      && user.roles[0] === mappedRole
      && user.role === mappedRole
    ) {
      continue;
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { roles: [mappedRole], role: pickPrimaryRole([mappedRole]) } },
    );
    migrated += 1;
  }

  return { migrated, skipped };
}

const LEGACY_SCRUBBED_EMAIL = /^deleted\+[a-f0-9]{24}@internal$/i;
/** Password placeholder written on delete before we started preserving hashes. */
export const REVOKED_DELETED_PASSWORD = 'revoked-deleted-user-password';

function newRawToken() {
  return randomBytes(32).toString('hex');
}

/** Legacy hard-delete scrub: inactive row with synthetic email — treat as deleted. */
export function isAccountDeleted(user) {
  if (!user) return false;
  if (user.status === 'deleted') return true;
  const email = typeof user.email === 'string' ? user.email : '';
  return LEGACY_SCRUBBED_EMAIL.test(email);
}

/** Deleted users with a real email can be restored; scrubbed legacy rows cannot. */
export function canReactivateDeleted(user) {
  if (!isAccountDeleted(user)) return false;
  const email = typeof user.email === 'string' ? user.email : '';
  return !LEGACY_SCRUBBED_EMAIL.test(email);
}

function normaliseRolesInput(body) {
  if (body.roles?.length) {
    const roles = [...new Set(body.roles)];
    return { ...body, roles, role: pickPrimaryRole(roles) };
  }
  if (body.role) {
    return { ...body, roles: [body.role] };
  }
  return body;
}

/**
 * Super Admin is hidden from normal user listing/search APIs for every caller.
 * This endpoint is intentionally not a Super Admin management surface.
 */
export async function listUsers(actor, query = {}) {
  const filter = {};
  const includeSuperAdmins = query.includeSuperAdmins === true
    || query.includeSuperAdmins === 'true';

  if (query.role === ROLE_IDS.SUPER_ADMIN) filter._id = { $in: [] };
  else if (query.role) Object.assign(filter, userHasRoleQuery(query.role));
  else if (!(includeSuperAdmins && isSuperAdmin(actor))) {
    Object.assign(filter, NOT_SUPER_ADMIN_FILTER);
  }

  if (query.status) filter.status = query.status;
  if (query.q) {
    const safe = String(query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: safe, $options: 'i' } },
      { email: { $regex: safe, $options: 'i' } },
    ];
  }

  const page = await paginate(User, filter, {
    page: query.page, limit: query.limit, sortBy: query.sortBy || 'name:asc',
  });
  return { ...page, results: page.results.map((u) => u.toJSON()) };
}

function assertVisibleToActor(actor, target) {
  if (isSuperAdmin(target)) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
}

export async function getUser(actor, id) {
  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  assertVisibleToActor(actor, user);
  return user.toJSON();
}

export async function updateUser(actor, id, body) {
  if (String(actor._id) === String(id) && (body.role || body.roles || body.status)) {
    throw new ApiError(400, 'CANNOT_MODIFY_SELF', 'You cannot change your own role or status');
  }

  const nextBody = normaliseRolesInput(body);
  if (nextBody.roles?.includes(ROLE_IDS.SUPER_ADMIN)) {
    throw new ApiError(
      403,
      'SUPER_ADMIN_PROTECTED',
      'Super Admin role can only be granted via protected bootstrap/admin operations',
    );
  }

  const existing = await User.findById(id);
  if (!existing) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  assertVisibleToActor(actor, existing);
  if (isAccountDeleted(existing)) {
    throw new ApiError(400, 'USER_DELETED', 'Deleted users cannot be modified');
  }

  const user = await User.findByIdAndUpdate(id, { $set: nextBody }, { new: true, runValidators: true });
  return user.toJSON();
}

export async function updateMe(actor, body) {
  const user = await User.findByIdAndUpdate(
    actor._id,
    { $set: body },
    { new: true, runValidators: true },
  );
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  return user.toJSON();
}

export async function updateNotificationPrefs(actor, { email = {}, inApp = {} }) {
  const user = await User.findById(actor._id);

  for (const [channel, flags] of [['email', email], ['inApp', inApp]]) {
    for (const [event, enabled] of Object.entries(flags)) {
      if (!NOTIFICATION_EVENTS.includes(event)) {
        throw new ApiError(400, 'UNKNOWN_EVENT', `"${event}" is not a notification event`);
      }
      user.notificationPrefs[channel].set(event, enabled);
    }
  }

  await user.save();
  return user.toJSON();
}

function normalizeTicketPreferencesForDb(prefs) {
  const next = mergeTicketPreferences(prefs);
  next.filters.assignedTo = next.filters.assignedTo || null;
  return next;
}

function serialiseTicketPreferences(user) {
  const raw = user.ticketPreferences?.toObject?.() ?? user.ticketPreferences ?? {};
  const prefs = mergeTicketPreferences(raw);
  const assignedTo = prefs.filters.assignedTo;
  prefs.filters.assignedTo = assignedTo ? String(assignedTo._id ?? assignedTo) : '';
  return normalizeTicketPreferencesForUser(user, prefs);
}

export async function getTicketPreferences(actor) {
  const user = await User.findById(actor._id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  return serialiseTicketPreferences(user);
}

export async function updateTicketPreferences(actor, body) {
  const user = await User.findById(actor._id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');

  const current = serialiseTicketPreferences(user);

  if (body.filters) {
    for (const [key, value] of Object.entries(body.filters)) {
      if (!(key in current.filters)) continue;
      if (key === 'assignedTo') {
        current.filters.assignedTo = value || null;
      } else if (key === 'scope') {
        current.filters.scope = value || 'all';
      } else {
        current.filters[key] = value;
      }
    }
  }

  if (body.sort) {
    if ('column' in body.sort) current.sort.column = body.sort.column ?? null;
    if ('direction' in body.sort) current.sort.direction = body.sort.direction ?? null;
  }

  if (body.boardMine !== undefined) current.boardMine = Boolean(body.boardMine);
  if (body.limit !== undefined) current.limit = body.limit;

  const normalized = normalizeTicketPreferencesForUser(user, current);
  user.ticketPreferences = normalizeTicketPreferencesForDb(normalized);
  user.markModified('ticketPreferences');
  await user.save();
  return user.toJSON();
}

export async function resetTicketPreferences(actor) {
  const user = await User.findById(actor._id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');

  user.ticketPreferences = normalizeTicketPreferencesForDb(defaultTicketPreferencesForUser(actor));
  user.markModified('ticketPreferences');
  await user.save();
  return user.toJSON();
}

export async function deleteUser(actor, id) {
  if (String(actor._id) === String(id)) {
    throw new ApiError(400, 'CANNOT_DELETE_SELF', 'You cannot delete your own account');
  }

  const user = await User.findById(id).select('+refreshTokens +consumedRefreshTokens +inviteTokenHash');
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  assertVisibleToActor(actor, user);

  if (isAccountDeleted(user)) {
    if (user.status !== 'deleted') {
      user.status = 'deleted';
      await user.save();
    }
    return { status: 'deleted' };
  }

  if (hasAnyRole(user, ROLE_IDS.ADMIN)) {
    const otherAdmins = await User.countDocuments({
      ...userHasRoleQuery(ROLE_IDS.ADMIN),
      _id: { $ne: user._id },
      status: 'active',
    });
    if (otherAdmins === 0) {
      throw new ApiError(400, 'LAST_ADMIN', 'Cannot delete the last admin');
    }
  }
  if (isSuperAdmin(user)) {
    const otherSuperAdmins = await User.countDocuments({
      ...userHasRoleQuery(ROLE_IDS.SUPER_ADMIN),
      _id: { $ne: user._id },
      status: 'active',
    });
    if (otherSuperAdmins === 0) {
      throw new ApiError(400, 'LAST_SUPER_ADMIN', 'Cannot delete the last Super Admin');
    }
  }

  await revokeAllRefreshTokens(user._id);

  user.status = 'deleted';
  user.inviteTokenHash = undefined;
  user.inviteTokenExpiresAt = undefined;
  user.refreshTokens = [];
  user.consumedRefreshTokens = [];
  await user.save();

  return { status: 'deleted' };
}

/**
 * Restores a soft-deleted user. Preserved password → active immediately; revoked
 * password (legacy deletes) → invited with a setup link reusing accept-invite.
 */
export async function reactivateUser(actor, id) {
  if (String(actor._id) === String(id)) {
    throw new ApiError(400, 'CANNOT_MODIFY_SELF', 'You cannot reactivate your own account');
  }

  const user = await User.findById(id).select('+password +inviteTokenHash +inviteTokenExpiresAt');
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  assertVisibleToActor(actor, user);

  if (!isAccountDeleted(user)) {
    throw new ApiError(400, 'USER_NOT_DELETED', 'Only deleted users can be reactivated');
  }
  if (!canReactivateDeleted(user)) {
    throw new ApiError(
      400,
      'USER_NOT_REACTIVATABLE',
      'This deleted account cannot be restored because its email was scrubbed',
    );
  }

  const needsPasswordSetup = await user.isPasswordMatch(REVOKED_DELETED_PASSWORD);

  if (needsPasswordSetup) {
    const inviteToken = newRawToken();
    user.status = 'invited';
    user.inviteTokenHash = hashToken(inviteToken);
    user.inviteTokenExpiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600000);
    await user.save();
    return { user: user.toJSON(), inviteToken, requiresPassword: true };
  }

  user.status = 'active';
  user.inviteTokenHash = undefined;
  user.inviteTokenExpiresAt = undefined;
  await user.save();
  return { user: user.toJSON(), requiresPassword: false };
}
