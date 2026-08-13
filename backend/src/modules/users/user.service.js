import { NOTIFICATION_EVENTS } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import User from './user.model.js';

export async function listUsers(query = {}) {
  const filter = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.q) {
    // Escaped: a query string must not be able to inject regex metacharacters.
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

export async function getUser(id) {
  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  return user.toJSON();
}

export async function updateUser(actor, id, body) {
  // An admin locking themselves out of their own installation files a support
  // ticket nobody can read, because filing it requires logging in.
  if (String(actor._id) === String(id) && (body.role || body.status)) {
    throw new ApiError(400, 'CANNOT_MODIFY_SELF', 'You cannot change your own role or status');
  }

  const user = await User.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
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
