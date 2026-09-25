import { externalFacingTicketStatus, isExternalUser, stageLabel } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import { buildExternalTicketFilter, sanitizeExternalTicket } from '../access/external-auth.service.js';
import Ticket from '../tickets/ticket.model.js';
import Notification from './notification.model.js';

const idStr = (v) => (v ? String(v._id ?? v) : null);

function ticketProjectId(ticket) {
  const project = ticket?.project;
  if (!project) return null;
  if (typeof project === 'object' && project._id) return String(project._id);
  return String(project);
}

/** `comment` lets the ticket page scroll to and highlight the comment. */
export function buildNotificationLink(ticket, config, { commentId = null } = {}) {
  const params = new URLSearchParams({ ticket: ticket.ticketId });
  const projectId = ticketProjectId(ticket);
  if (projectId) params.set('project', projectId);
  if (commentId) params.set('comment', String(commentId));
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
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Estimates are date-only values stored as UTC midnight (the API takes an ISO
 * date from a date input). Formatting in the server's zone would show the day
 * before anywhere west of UTC, so this matches the email: en-GB, in UTC.
 */
function formatEstimateDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

const COMMENT_EVENTS = new Set(['TICKET_COMMENTED', 'TICKET_MENTIONED']);

/** A client only ever sees the collapsed status (Under Review / Live / Closed). */
function stageLabelFor(status, external) {
  return stageLabel(external ? externalFacingTicketStatus(status) : status);
}

function assignmentTitle(actor, id, ticket, context, recipient) {
  const recipientId = idStr(recipient);
  const assigneeId = idStr(ticket.assignedTo);
  if (assigneeId && assigneeId === recipientId) return `${actor} assigned ${id} to you`;
  if (context.previousAssignee && idStr(context.previousAssignee) === recipientId) {
    return `${actor} unassigned you from ${id}`;
  }
  const assignee = nameOfRef(ticket.assignedTo);
  if (assignee) return `${actor} assigned ${id} to ${assignee}`;
  if (!assigneeId) return `${actor} unassigned ${id}`;
  return `${actor} changed the assignee on ${id}`;
}

/** "<Actor> <verb> <TICKETID>", written for the one person reading it. */
function notificationTitle(event, ticket, context, recipient) {
  const actor = context.actorName || 'Someone';
  const id = ticket.ticketId;
  switch (event) {
    case 'TICKET_CREATED':
      return `${actor} filed ${id}`;
    case 'TICKET_ASSIGNED':
      return assignmentTitle(actor, id, ticket, context, recipient);
    case 'TICKET_STAGE_CHANGED':
      return `${actor} moved ${id} to ${stageLabelFor(context.to ?? ticket.status, isExternalUser(recipient))}`;
    case 'TICKET_REOPENED':
      return `${actor} reopened ${id}`;
    case 'TICKET_CLOSED':
      return `${actor} closed ${id}`;
    case 'TICKET_COMMENTED':
      return `${actor} commented on ${id}`;
    case 'TICKET_MENTIONED':
      return `${actor} mentioned you on ${id}`;
    case 'TICKET_ESTIMATE_SET':
      return `${actor} updated dates on ${id}`;
    default:
      return `${actor} updated ${id}`;
  }
}

function bodyDetail(event, ticket, context, external) {
  switch (event) {
    case 'TICKET_COMMENTED':
    case 'TICKET_MENTIONED':
      return context.comment || '';
    case 'TICKET_CLOSED':
    case 'TICKET_REOPENED':
      // note/reason are internal judgement (close reasons, QA rejections) —
      // the same rule the external email context follows in dispatch.js.
      return external ? '' : (context.reason || context.note || '');
    case 'TICKET_ESTIMATE_SET': {
      const resolution = formatEstimateDate(ticket.estimatedResolutionAt);
      const release = formatEstimateDate(ticket.expectedReleaseDate);
      const parts = [];
      if (resolution) parts.push(`Target ${resolution}`);
      if (release) parts.push(`Release ${release}`);
      return parts.join(' · ');
    }
    default:
      return '';
  }
}

/** The ticket title, then what happened: "<ticket title> — <detail>", 140 chars max. */
function notificationBody(event, ticket, context, recipient) {
  const title = ticket.title || '';
  const detail = bodyDetail(event, ticket, context, isExternalUser(recipient));
  return truncate(detail ? `${title} — ${detail}` : title, 140);
}

/** Addressed to this reader rather than to everyone on the ticket. */
function isForYou(event, ticket, recipient) {
  const recipientId = idStr(recipient);
  if (event === 'TICKET_MENTIONED') return true;
  if (event === 'TICKET_ASSIGNED') return idStr(ticket.assignedTo) === recipientId;
  if (event === 'TICKET_COMMENTED') return idStr(ticket.createdBy) === recipientId;
  return false;
}

/**
 * One row per recipient, written or folded. Title and body are built per
 * recipient: they say "you", and an external recipient's never carry notes.
 *
 * A routine update folds into the recipient's unread, not-for-you row on the
 * same ticket (latest title/body/link, count + 1, activityAt now), so a busy
 * ticket is one line in the list rather than twenty. A for-you event always
 * gets its own row. Returns every row touched, inserted or folded; a folded row
 * keeps its id, so push and the email batch still point at a real row.
 *
 * Two events for the same person and ticket landing at the same instant can
 * both miss and both insert, leaving two unread rows; the next update folds
 * into the newer one. Harmless, so there is no unique index to prevent it.
 */
export async function createInAppNotifications(event, ticket, recipients, config, context = {}) {
  const link = buildNotificationLink(ticket, config, {
    commentId: COMMENT_EVENTS.has(event) ? context.commentId : null,
  });
  const project = ticketProjectId(ticket);
  const activityAt = new Date();

  const outcomes = await Promise.all(recipients
    .filter((r) => r.channels.inApp)
    .map(async (r) => {
      const row = {
        user: r.user._id,
        event,
        ticket: ticket._id,
        project,
        title: notificationTitle(event, ticket, context, r.user),
        body: notificationBody(event, ticket, context, r.user),
        link,
        activityAt,
      };
      if (isForYou(event, ticket, r.user)) return { insert: { ...row, forYou: true } };

      const folded = await Notification.findOneAndUpdate(
        // $ne, not false: rows written before the field existed have none.
        { user: row.user, ticket: row.ticket, readAt: null, forYou: { $ne: true } },
        {
          $set: {
            event, title: row.title, body: row.body, link, project, activityAt,
          },
          $inc: { count: 1 },
        },
        { new: true, sort: { activityAt: -1 } },
      );
      return folded ? { folded } : { insert: row };
    }));

  const inserts = outcomes.filter((o) => o.insert).map((o) => o.insert);
  const inserted = inserts.length ? await Notification.insertMany(inserts) : [];
  return [...outcomes.filter((o) => o.folded).map((o) => o.folded), ...inserted];
}

/**
 * Rows written before `project` existed get it from their ticket. Runs at boot;
 * only touches rows missing the field, so after the first run it is one
 * distinct() that finds nothing. Rows whose ticket is gone stay without one.
 */
export async function backfillNotificationProjects() {
  const ticketIds = await Notification.distinct('ticket', {
    project: { $exists: false }, ticket: { $ne: null },
  });
  if (ticketIds.length === 0) return 0;

  const tickets = await Ticket.find({ _id: { $in: ticketIds } }).select('project').lean();
  const ops = tickets
    .filter((t) => t.project)
    .map((t) => ({
      updateMany: {
        filter: { ticket: t._id, project: { $exists: false } },
        update: { $set: { project: t.project } },
      },
    }));
  if (ops.length === 0) return 0;

  const result = await Notification.bulkWrite(ops, { ordered: false });
  return result.modifiedCount;
}

/**
 * Rows written before `activityAt` existed sort by when they were created. One
 * updateMany, idempotent: after the first boot it matches nothing.
 */
export async function backfillNotificationActivity() {
  const result = await Notification.updateMany(
    { activityAt: { $exists: false } },
    [{
      $set: {
        activityAt: { $ifNull: ['$createdAt', '$$NOW'] },
        count: { $ifNull: ['$count', 1] },
      },
    }],
  );
  return result.modifiedCount;
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

/**
 * The actor's own rows, optionally one project and/or one ticket. The row
 * carries its project, so internal users need no ticket lookup. External
 * access is granted and revoked per project, so their rows are also held to the
 * tickets they can still see.
 */
async function notificationFilter(actor, {
  project = null, ticket = null, unread = false, forYou = false,
} = {}) {
  const filter = { user: actor._id };
  if (unread) filter.readAt = null;
  if (forYou) filter.forYou = true;
  if (project) filter.project = project;
  if (ticket) filter.ticket = ticket;

  if (isExternalUser(actor)) {
    const scope = await buildExternalTicketFilter(actor);
    const visibleIds = await Ticket.find(project ? { $and: [scope, { project }] } : scope).distinct('_id');
    filter.$and = [{ ticket: { $in: visibleIds } }];
  }
  return filter;
}

const PROJECT_CHIP = { path: 'project', select: 'key name' };

export async function listNotifications(actor, query = {}) {
  const filter = await notificationFilter(actor, {
    project: query.project ? String(query.project) : null,
    unread: String(query.unread) === 'true',
    forYou: String(query.forYou) === 'true',
  });

  const page = await paginate(Notification, filter, {
    page: query.page,
    limit: query.limit,
    sortBy: 'activityAt:desc,_id:desc',
    populate: ['ticket', PROJECT_CHIP],
  });
  return {
    ...page,
    results: page.results.map((n) => externalizeNotification(n.toJSON(), actor)),
  };
}

export async function markRead(actor, id) {
  const notification = await Notification.findOne({ _id: id, user: actor._id })
    .populate('ticket')
    .populate(PROJECT_CHIP);
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

/** `ticket` marks only that ticket's rows, e.g. when the person opens it. */
export async function markAllRead(actor, query = {}) {
  const filter = await notificationFilter(actor, {
    project: query.project ? String(query.project) : null,
    ticket: query.ticket ? String(query.ticket) : null,
    unread: true,
  });

  const result = await Notification.updateMany(
    filter,
    { $set: { readAt: new Date() } },
  );
  return { updated: result.modifiedCount };
}
