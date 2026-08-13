import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import Notification from './notification.model.js';

const TITLES = {
  TICKET_CREATED: (t) => `${t.ticketId} was filed`,
  TICKET_ASSIGNED: (t) => `${t.ticketId} was assigned`,
  TICKET_STAGE_CHANGED: (t) => `${t.ticketId} moved stage`,
  TICKET_REOPENED: (t) => `${t.ticketId} was reopened`,
  TICKET_CLOSED: (t) => `${t.ticketId} was closed`,
  TICKET_COMMENTED: (t) => `New comment on ${t.ticketId}`,
  TICKET_MENTIONED: (t) => `You were mentioned on ${t.ticketId}`,
  TICKET_ESTIMATE_SET: (t) => `Estimates set on ${t.ticketId}`,
};

/**
 * One row per recipient, via insertMany. A Notification row is a single
 * idempotent database write, so the in-app channel genuinely IS exactly-once —
 * only email carries the duplicate risk.
 */
export async function createInAppNotifications(event, ticket, recipients, config) {
  const rows = recipients
    .filter((r) => r.channels.inApp)
    .map((r) => ({
      user: r.user._id,
      event,
      ticket: ticket._id,
      title: (TITLES[event] ?? (() => ticket.ticketId))(ticket),
      body: ticket.title,
      link: `${config.frontendBaseUrl}/tickets?ticket=${ticket.ticketId}`,
    }));

  if (rows.length === 0) return [];
  return Notification.insertMany(rows);
}

export async function listNotifications(actor, query = {}) {
  const filter = { user: actor._id };
  if (String(query.unread) === 'true') filter.readAt = null;

  const page = await paginate(Notification, filter, {
    page: query.page, limit: query.limit, sortBy: 'createdAt:desc', populate: ['ticket'],
  });
  return { ...page, results: page.results.map((n) => n.toJSON()) };
}

export async function markRead(actor, id) {
  // Scoped to the actor in the FILTER, not checked after the load: a
  // notification belonging to someone else simply does not match.
  const updated = await Notification.findOneAndUpdate(
    { _id: id, user: actor._id },
    { $set: { readAt: new Date() } },
    { new: true },
  );
  if (!updated) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  return updated.toJSON();
}

export async function markAllRead(actor) {
  const result = await Notification.updateMany(
    { user: actor._id, readAt: null },
    { $set: { readAt: new Date() } },
  );
  return { updated: result.modifiedCount };
}
