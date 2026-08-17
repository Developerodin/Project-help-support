import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import { buildExternalTicketFilter, isExternalRole } from '../access/external-auth.service.js';
import Ticket from '../tickets/ticket.model.js';
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

  if (isExternalRole(actor.role)) {
    const ticketScope = await buildExternalTicketFilter(actor);
    const visibleIds = await Ticket.find(ticketScope).distinct('_id');
    filter.ticket = { $in: visibleIds.length ? visibleIds : [null] };
  }

  const page = await paginate(Notification, filter, {
    page: query.page, limit: query.limit, sortBy: 'createdAt:desc', populate: ['ticket'],
  });
  return { ...page, results: page.results.map((n) => n.toJSON()) };
}

export async function markRead(actor, id) {
  const notification = await Notification.findOne({ _id: id, user: actor._id }).populate('ticket');
  if (!notification) {
    throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }

  if (isExternalRole(actor.role) && notification.ticket) {
    const ticketScope = await buildExternalTicketFilter(actor);
    const visibleIds = await Ticket.find(ticketScope).distinct('_id');
    const ticketId = String(notification.ticket._id ?? notification.ticket);
    if (!visibleIds.some((id) => String(id) === ticketId)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this notification');
    }
  }

  if (!notification.readAt) {
    notification.readAt = new Date();
    await notification.save();
  }
  return notification.toJSON();
}

export async function markAllRead(actor) {
  const result = await Notification.updateMany(
    { user: actor._id, readAt: null },
    { $set: { readAt: new Date() } },
  );
  return { updated: result.modifiedCount };
}
