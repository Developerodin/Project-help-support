import { NOTIFICATION_EVENTS, externalFacingTicketStatus, isExternalUser } from '@pms/shared';
import logger from '../../platform/logger.js';
import { getTransport } from '../../platform/mailer.js';
import Ticket from '../tickets/ticket.model.js';
import { publishNotificationCreated } from '../realtime/realtime.service.js';
import { getNotificationRecipients } from './recipients.js';
import { createInAppNotifications } from './notification.service.js';
import { sendPushForNotifications } from './push.service.js';
import {
  EMAIL_TICKET_POPULATE, enqueueTicketEmail, sendTransactionalEmail, sendUrgentTicketEmail,
} from './email.service.js';
import { renderInviteEmail, renderPasswordResetEmail } from '../../platform/email/templates/index.js';
import { ticketBranding, userBranding } from './branding.js';
import { mutedUserIds } from './ticketMute.model.js';
import { deliveryPrefs, quietUntil } from './delivery-schedule.js';

// Template spec and add-a-template checklist: docs/email/DESIGN.md

function findCommentOnTicket(ticket, commentId) {
  if (!commentId || !ticket?.comments?.length) return null;
  if (typeof ticket.comments.id === 'function') {
    return ticket.comments.id(commentId) ?? null;
  }
  return ticket.comments.find((c) => String(c._id) === String(commentId)) ?? null;
}

function nameOfRef(ref) {
  if (ref && typeof ref === 'object' && typeof ref.name === 'string') return ref.name;
  return '';
}

function hasBrandingContext(ticket, config) {
  const project = ticket?.project && typeof ticket.project === 'object' ? ticket.project : null;
  if (!project) return false;
  if (!config?.features?.attachments) return true;

  if (!project.client) return true;
  if (typeof project.client !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(project.client, 'logoKey');
}

/** Fields consumed by @pms/shared/email renderTicketEmail — see docs/email/DESIGN.md */
function buildEmailContext(event, ticket, actor) {
  const context = {
    from: event.from,
    to: event.to ?? ticket.status,
    note: event.note,
    reason: event.reason,
    requestId: event.requestId,
    actorName: actor?.name || 'Someone',
    mentions: event.mentions,
    commentId: event.commentId,
    // TICKET_ASSIGNED only: who held the ticket before, when that changed.
    previousAssignee: event.previousAssignee,
  };

  const commentEntry = findCommentOnTicket(ticket, event.commentId);
  if (commentEntry) {
    context.comment = commentEntry.content;
    context.commentAuthor = actor?.name || nameOfRef(commentEntry.commentedBy) || 'Someone';
  }

  return context;
}

async function resolveTicketForEmail(ticket, config) {
  const hasNames = ticket.createdBy && typeof ticket.createdBy === 'object' && ticket.createdBy.name;
  if (hasNames && hasBrandingContext(ticket, config)) return ticket;
  const id = ticket._id ?? ticket.id;
  return Ticket.findById(id).populate(EMAIL_TICKET_POPULATE);
}

/** `note`/`reason` carry internal judgement (close reasons, QA rejections) about
 * the client's own ticket — never in an external recipient's email context. */
function stripExternalContext(context) {
  const { note: _note, reason: _reason, ...safe } = context;
  return safe;
}

/** A client sees the collapsed status (Under Review / Live / Closed), never the pipeline stage. */
function externalizeStages(context) {
  return {
    ...context,
    ...(context.from ? { from: externalFacingTicketStatus(context.from) } : {}),
    to: externalFacingTicketStatus(context.to),
  };
}

/** e.g. In Progress -> Ready for QA: both read "Under Review" to a client, so nothing happened for them. */
function isInvisibleToExternal(eventKey, context) {
  return eventKey === 'TICKET_STAGE_CHANGED'
    && Boolean(context.from && context.to)
    && externalFacingTicketStatus(context.from) === externalFacingTicketStatus(context.to);
}

/**
 * Mail that cannot wait for the batch: a mention, or the ticket landing on
 * you. Everything else (including an assignment to someone else, or being
 * unassigned) waits in the recipient's batch for this ticket.
 */
function isUrgentEmail(eventKey, ticket, user, context) {
  if (eventKey === 'TICKET_MENTIONED') return true;
  return eventKey === 'TICKET_ASSIGNED'
    && !context.unassignedYou
    && String(ticket.assignedTo?._id ?? ticket.assignedTo) === String(user._id);
}

/** Mentions and "the ticket is now yours": what reaches a person who muted the ticket or is in quiet hours. */
function isAddressedTo(eventKey, ticket, user) {
  return isUrgentEmail(eventKey, ticket, user, {});
}

/**
 * Push is the channel that wakes a phone, so quiet hours hold it back: a
 * routine update is not pushed at all (its in-app row is still there in the
 * morning), one addressed to the person only if they allow urgent ones.
 */
function pushAllowed(eventKey, ticket, user, config, now) {
  if (!quietUntil(user, config, now)) return true;
  return isAddressedTo(eventKey, ticket, user) && deliveryPrefs(user, config).quietHours.allowUrgent;
}

/** Returns the recipients it notified, so the caller can keep them out of a second fan-out. */
async function fanOut(eventKey, ticket, actor, context, config, deps, {
  hideFromExternal = false, excludeUserIds = null,
} = {}) {
  const recipients = await getNotificationRecipients(eventKey, ticket, actor, context);

  // An internal comment, or a stage move a client cannot tell apart, must not
  // surface to an external recipient on ANY channel — not even as "someone
  // commented" — so they are dropped before either channel runs, rather than
  // merely having context stripped.
  const dropExternal = hideFromExternal || isInvisibleToExternal(eventKey, context);
  const audience = recipients.filter((r) => {
    if (excludeUserIds?.has(String(r.user._id))) return false;
    return !(dropExternal && isExternalUser(r.user));
  });
  // Someone who muted the ticket hears nothing routine about it on any
  // channel; a mention or the ticket landing on them still gets through.
  const muted = await mutedUserIds(ticket._id, audience.map((r) => r.user._id));
  const visible = audience.filter((r) => !muted.has(String(r.user._id)) || isAddressedTo(eventKey, ticket, r.user));
  if (visible.length === 0) return [];

  const emailTicket = await resolveTicketForEmail(ticket, config);
  const branding = ticketBranding(emailTicket, config);
  const emailContext = branding ? { ...context, ...branding } : context;

  const inAppRows = await createInAppNotifications(eventKey, ticket, visible, config, context);
  if (inAppRows.length) publishNotificationCreated(inAppRows.map((row) => row.user));
  // Not awaited: push services can be slow, and the request already succeeded.
  // Push mirrors the in-app rows, so it obeys the in-app preferences.
  const now = new Date();
  const usersById = new Map(visible.map((r) => [String(r.user._id), r.user]));
  const pushRows = inAppRows.filter((row) => {
    const user = usersById.get(String(row.user));
    return !user || pushAllowed(eventKey, ticket, user, config, now);
  });
  (deps.sendPush ?? sendPushForNotifications)(pushRows, config).catch((err) => {
    logger.error('Push fan-out failed', { error: err.message, event: eventKey, ticket: ticket?.ticketId });
  });

  // Context is built ONCE per event and would otherwise be shared verbatim
  // across every recipient's email. Split it here, at send time, rather than
  // threading a per-recipient context through sendTicketEmail/renderTicketEmail:
  // external recipients lose notes and see client-facing statuses, and a
  // previous assignee reads "unassigned you" instead of "assigned to you".
  const previousAssignee = eventKey === 'TICKET_ASSIGNED' ? context.previousAssignee : null;
  const groups = new Map();
  for (const r of visible) {
    const external = isExternalUser(r.user);
    const unassigned = Boolean(previousAssignee) && String(r.user._id) === String(previousAssignee);
    const key = `${external}:${unassigned}`;
    if (!groups.has(key)) {
      let groupContext = external ? externalizeStages(stripExternalContext(emailContext)) : emailContext;
      if (unassigned) groupContext = { ...groupContext, unassignedYou: true };
      groups.set(key, { external, context: groupContext, recipients: [] });
    }
    groups.get(key).recipients.push(r);
  }

  // Each batched event remembers the in-app row it landed on, so reading
  // that row in the app takes the event out of the email.
  const notificationIds = new Map(inAppRows.map((row) => [String(row.user), row._id]));

  // Internal groups first, so the test sink copy shows the internal rendering.
  let testSinkUsed = false;
  const ordered = [...groups.values()].sort((a, b) => Number(a.external) - Number(b.external));
  for (const group of ordered) {
    const urgent = [];
    for (const r of group.recipients) {
      if (!r.channels.email) continue;
      const prefs = deliveryPrefs(r.user, config);
      if (prefs.emailPaused) continue;
      const notificationId = notificationIds.get(String(r.user._id));
      if (isUrgentEmail(eventKey, ticket, r.user, group.context)) {
        // Quiet hours without urgent exceptions: it waits for the morning in
        // this ticket's batch, still marked urgent so reading it in-app
        // overnight does not drop it from the email.
        const quietEnd = prefs.quietHours.allowUrgent ? null : quietUntil(r.user, config, now);
        if (quietEnd) {
          await enqueueTicketEmail(r.user._id, emailTicket, {
            event: eventKey, context: group.context, notificationId, urgent: true,
          }, config, { holdUntil: quietEnd });
        } else {
          urgent.push(r);
        }
        continue;
      }
      // Whoever is left on an assignment is neither the old nor the new assignee.
      const context = eventKey === 'TICKET_ASSIGNED' && !group.context.unassignedYou
        ? { ...group.context, assignedElsewhere: true }
        : group.context;
      // `recipient` lets their hourly/daily slot and quiet hours hold the batch.
      await enqueueTicketEmail(r.user._id, emailTicket, {
        event: eventKey, context, notificationId,
      }, config, { recipient: r.user, now });
    }
    if (urgent.length === 0) continue;
    await sendUrgentTicketEmail(eventKey, emailTicket, urgent, group.context, config, {
      ...deps,
      allowTestSink: !testSinkUsed,
      notificationIds,
    });
    testSinkUsed = true;
  }

  return visible;
}

/**
 * Runs AFTER the write has committed, and CANNOT fail the request. The
 * transition already returned 200 the moment the ticket was saved; everything
 * here is best-effort, with failures caught and logged.
 */
export async function dispatchTicketEvent({ event, ticket, actor, config, deps = {} }) {
  try {
    if (!NOTIFICATION_EVENTS.includes(event.type)) {
      logger.warn('Unknown notification event, nothing dispatched', { type: event.type });
      return;
    }

    const context = buildEmailContext(event, ticket, actor);

    // Computed once, from the same comment lookup buildEmailContext already
    // did, and reused for both fan-outs below: an internal comment must be
    // invisible to an external recipient whether they hear about it as a
    // comment or as a mention.
    const commentIsInternal = event.type === 'TICKET_COMMENTED'
      && findCommentOnTicket(ticket, event.commentId)?.internal === true;

    // TICKET_MENTIONED is its OWN fan-out with its own recipient set and its own
    // preference key — it never unions the comment audience, or mentioning one
    // person notifies the whole ticket twice. It runs first so that whoever
    // hears about this comment as a mention is left out of the comment fan-out.
    const mentioned = new Set();
    if (event.type === 'TICKET_COMMENTED' && event.mentions?.length) {
      const heard = await fanOut(
        'TICKET_MENTIONED', ticket, actor,
        { ...context, mentions: event.mentions }, config, deps,
        { hideFromExternal: commentIsInternal },
      );
      for (const r of heard) {
        if (r.channels.inApp || r.channels.email) mentioned.add(String(r.user._id));
      }
    }

    await fanOut(event.type, ticket, actor, context, config, deps, {
      hideFromExternal: commentIsInternal,
      excludeUserIds: mentioned,
    });
  } catch (err) {
    logger.error('Notification dispatch failed', {
      error: err.message, event: event?.type, ticket: ticket?.ticketId,
    });
  }
}

async function sendPlain(config, deps, message, options = {}) {
  const result = await sendTransactionalEmail(
    options.kind,
    message,
    config,
    { transport: deps.transport ?? getTransport(config) },
    {
      throwOnError: options.throwOnError === true,
      requestId: options.requestId,
    },
  );

  if (!result.sent) {
    logger.warn('Transactional email queued for retry', {
      kind: options.kind,
      to: message.to,
      logId: result.logId,
      error: result.error,
      requestId: options.requestId,
    });
  }

  return result;
}

/**
 * A client must not read the vendor's name on their own mail, so both of these
 * resolve the recipient's company first. It can legitimately come back null —
 * an internal colleague has no client, and a first invite has none yet because
 * the client scope is granted through that very invite — and the neutral mark
 * is the honest answer in both cases.
 */
async function recipientBranding(user, config) {
  return (await userBranding(user?.id ?? user?._id, config)) ?? {};
}

/** Invite and reset mail, on the same pooled transport as everything else. */
export function buildInviteDeliverer(config, deps = {}) {
  return async ({ user, inviteToken }, options = {}) => {
    const link = `${config.frontendBaseUrl}/invite/accept?token=${inviteToken}`;
    const branding = await recipientBranding(user, config);
    const { subject, text, html } = renderInviteEmail({
      link,
      recipientEmail: user.email,
      brandName: branding.brandName,
    });
    return sendPlain(config, deps, {
      to: user.email,
      subject,
      text,
      html,
      ...branding,
    }, {
      kind: 'invite',
      throwOnError: options.throwOnError === true,
      requestId: options.requestId,
    });
  };
}

export function buildResetDeliverer(config, deps = {}) {
  return async ({ user, resetToken }, options = {}) => {
    const link = `${config.frontendBaseUrl}/reset-password?token=${resetToken}`;
    const branding = await recipientBranding(user, config);
    const { subject, text, html } = renderPasswordResetEmail({
      link,
      recipientName: user.name,
      brandName: branding.brandName,
    });
    return sendPlain(config, deps, {
      to: user.email,
      subject,
      text,
      html,
      ...branding,
    }, {
      kind: 'password_reset',
      throwOnError: options.throwOnError === true,
      requestId: options.requestId,
    });
  };
}
