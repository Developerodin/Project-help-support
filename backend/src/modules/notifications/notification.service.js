import { isExternalUser, stageLabel } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import { buildExternalTicketFilter, sanitizeExternalTicket } from '../access/external-auth.service.js';
import Ticket from '../tickets/ticket.model.js';
import Notification from './notification.model.js';

function ticketProjectId(ticket) {
  const project = ticket?.project;
  if (!project) return null;
  if (typeof project === 'object' && project._id) return String(project._id);
  return String(project);
}

export function buildNotificationLink(ticket, config) {
  const params = new URLSearchParams({ ticket: ticket.ticketId });
  const projectId = ticketProjectId(ticket);
  if (projectId) params.set('project', projectId);
  return `${config.frontendBaseUrl}/tickets?${params.toString()}`;
}

function nameOfRef(ref) {
  if (ref && typeof ref === 'object' && typeof ref.name === 'string' && ref.name.trim()) {
    return ref.name.trim();
  }
  return '';
}

function truncate(text, max = 140) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function formatEstimateDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const SHORT_ACTION = Object.freeze({
  TICKET_CREATED: 'Filed',
  TICKET_ASSIGNED: 'Assigned',
  TICKET_STAGE_CHANGED: 'Stage changed',
  TICKET_REOPENED: 'Reopened',
  TICKET_CLOSED: 'Closed',
  TICKET_COMMENTED: 'New comment',
  TICKET_MENTIONED: 'Mentioned',
  TICKET_ESTIMATE_SET: 'Estimates updated',
});

function notificationTitle(event, ticket) {
  const action = SHORT_ACTION[event] ?? 'Update';
  return `${ticket.ticketId} · ${action}`;
}

function notificationBody(event, ticket, context = {}) {
  switch (event) {
    case 'TICKET_STAGE_CHANGED':
      if (context.from && context.to) {
        return `${stageLabel(context.from)} → ${stageLabel(context.to)}`;
      }
      return stageLabel(ticket.status);
    case 'TICKET_REOPENED':
      if (context.to) return `Back to ${stageLabel(context.to)}`;
      return 'Ticket reopened for more work';
    case 'TICKET_CLOSED':
      if (context.reason) return truncate(`Closed: ${context.reason}`, 140);
      if (context.note) return truncate(`Closed: ${context.note}`, 140);
      return 'Marked closed';
    case 'TICKET_ASSIGNED': {
      const assignee = nameOfRef(ticket.assignedTo);
      if (assignee) return `Assigned to ${assignee}`;
      const actor = context.actorName;
      return actor ? `${actor} updated assignment` : 'Assignment updated';
    }
    case 'TICKET_COMMENTED':
      if (context.comment) return truncate(context.comment, 140);
      return truncate(ticket.title, 140);
    case 'TICKET_MENTIONED':
      if (context.comment) return truncate(context.comment, 140);
      return 'You were mentioned in a comment';
    case 'TICKET_ESTIMATE_SET': {
      const resolution = formatEstimateDate(ticket.estimatedResolutionAt);
      const release = formatEstimateDate(ticket.expectedReleaseDate);
      const parts = [];
      if (resolution) parts.push(`Target ${resolution}`);
      if (release) parts.push(`Release ${release}`);
      return parts.length ? parts.join(' · ') : 'Delivery dates updated';
    }
    case 'TICKET_CREATED':
      return truncate(ticket.title, 140);
    default:
      return truncate(ticket.title, 140);
  }
}

/**
 * One row per recipient, via insertMany. A Notification row is a single
 * idempotent database write, so the in-app channel genuinely IS exactly-once —
 * only email carries the duplicate risk.
 */
export async function createInAppNotifications(event, ticket, recipients, config, context = {}) {
  const title = notificationTitle(event, ticket);
  const body = notificationBody(event, ticket, context);
  const link = buildNotificationLink(ticket, config);

  const rows = recipients
    .filter((r) => r.channels.inApp)
    .map((r) => ({
      user: r.user._id,
      event,
      ticket: ticket._id,
      title,
      body,
      link,
    }));

  if (rows.length === 0) return [];
  return Notification.insertMany(rows);
}

/** The populated `ticket` on a notification is a full internal document — an
 * external recipient must see it through the same sanitizer every other
 * external-facing ticket read goes through. */
function externalizeNotification(notificationJson, actor) {
  if (!isExternalUser(actor) || !notificationJson.ticket) return notificationJson;
  return {
    ...notificationJson,
    ticket: sanitizeExternalTicket(notificationJson.ticket, { viewerId: actor._id }),
  };
}

/** Restrict notifications to tickets the actor may see, optionally within one project. */
async function notificationTicketFilter(actor, projectId) {
  const scope = {};
  if (isExternalUser(actor)) {
    Object.assign(scope, await buildExternalTicketFilter(actor));
  }
  if (projectId) {
    scope.project = projectId;
  }
  if (Object.keys(scope).length === 0) return null;

  const visibleIds = await Ticket.find(scope).distinct('_id');
  return { $in: visibleIds.length ? visibleIds : [null] };
}

export async function listNotifications(actor, query = {}) {
  const filter = { user: actor._id };
  if (String(query.unread) === 'true') filter.readAt = null;

  const projectId = query.project ? String(query.project) : null;
  const ticketFilter = await notificationTicketFilter(actor, projectId);
  if (ticketFilter) filter.ticket = ticketFilter;

  const page = await paginate(Notification, filter, {
    page: query.page, limit: query.limit, sortBy: 'createdAt:desc', populate: ['ticket'],
  });
  return {
    ...page,
    results: page.results.map((n) => externalizeNotification(n.toJSON(), actor)),
  };
}

export async function markRead(actor, id) {
  const notification = await Notification.findOne({ _id: id, user: actor._id }).populate('ticket');
  if (!notification) {
    throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }

  if (isExternalUser(actor) && notification.ticket) {
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
  return externalizeNotification(notification.toJSON(), actor);
}

export async function markAllRead(actor, query = {}) {
  const filter = { user: actor._id, readAt: null };
  const projectId = query.project ? String(query.project) : null;
  const ticketFilter = await notificationTicketFilter(actor, projectId);
  if (ticketFilter) filter.ticket = ticketFilter;

  const result = await Notification.updateMany(
    filter,
    { $set: { readAt: new Date() } },
  );
  return { updated: result.modifiedCount };
}
