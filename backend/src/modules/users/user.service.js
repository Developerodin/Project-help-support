import { ROLE_IDS, NOTIFICATION_EVENTS, isSuperAdmin, hasAnyRole, pickPrimaryRole } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import Notification from '../notifications/notification.model.js';
import Team from '../teams/team.model.js';
import Ticket from '../tickets/ticket.model.js';
import User from './user.model.js';
import { NOT_SUPER_ADMIN_FILTER, userHasRoleQuery } from './user-role-query.js';

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
  if (query.role === ROLE_IDS.SUPER_ADMIN) filter._id = { $in: [] };
  else if (query.role) Object.assign(filter, userHasRoleQuery(query.role));
  else Object.assign(filter, NOT_SUPER_ADMIN_FILTER);

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

export async function deleteUser(actor, id) {
  if (String(actor._id) === String(id)) {
    throw new ApiError(400, 'CANNOT_DELETE_SELF', 'You cannot delete your own account');
  }

  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  assertVisibleToActor(actor, user);

  if (hasAnyRole(user, ROLE_IDS.ADMIN)) {
    const otherAdmins = await User.countDocuments({
      ...userHasRoleQuery(ROLE_IDS.ADMIN),
      _id: { $ne: user._id },
    });
    if (otherAdmins === 0) {
      throw new ApiError(400, 'LAST_ADMIN', 'Cannot delete the last admin');
    }
  }
  if (isSuperAdmin(user)) {
    const otherSuperAdmins = await User.countDocuments({
      ...userHasRoleQuery(ROLE_IDS.SUPER_ADMIN),
      _id: { $ne: user._id },
    });
    if (otherSuperAdmins === 0) {
      throw new ApiError(400, 'LAST_SUPER_ADMIN', 'Cannot delete the last Super Admin');
    }
  }

  await Promise.all([
    Notification.deleteMany({ user: user._id }),
    Team.updateMany({ members: user._id }, { $pull: { members: user._id } }),
    Team.updateMany({ lead: user._id }, { $unset: { lead: 1 } }),
    Ticket.updateMany({ assignedTo: user._id }, { $set: { assignedTo: null } }),
    Ticket.updateMany({ testedBy: user._id }, { $set: { testedBy: null } }),
    Ticket.updateMany({ watchers: user._id }, { $pull: { watchers: user._id } }),
    Ticket.updateMany(
      { blockedBy: user._id },
      { $set: { blocked: false }, $unset: { blockedBy: 1, blockedAt: 1, blockerReason: 1 } },
    ),
  ]);

  user.name = 'Deleted User';
  user.email = `deleted+${user._id}@internal`;
  user.status = 'inactive';
  user.inviteTokenHash = undefined;
  user.inviteTokenExpiresAt = undefined;
  user.refreshTokens = [];
  user.password = 'revoked-deleted-user-password';
  await user.save();

  return { status: 'deleted' };
}
