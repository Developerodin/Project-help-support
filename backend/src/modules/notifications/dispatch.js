import { NOTIFICATION_EVENTS, isExternalUser } from '@pms/shared';
import logger from '../../platform/logger.js';
import { getTransport } from '../../platform/mailer.js';
import Ticket from '../tickets/ticket.model.js';
import { getNotificationRecipients } from './recipients.js';
import { createInAppNotifications } from './notification.service.js';
import { sendTicketEmail } from './email.service.js';
import { renderInviteEmail, renderPasswordResetEmail } from '../../platform/email/templates/index.js';
import { brandAttachments } from '../../platform/email/logo.js';

// Template spec and add-a-template checklist: docs/email/DESIGN.md

const EMAIL_TICKET_POPULATE = ['assignedTo', 'createdBy'];

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
  };

  const commentEntry = findCommentOnTicket(ticket, event.commentId);
  if (commentEntry) {
    context.comment = commentEntry.content;
    context.commentAuthor = actor?.name || nameOfRef(commentEntry.commentedBy) || 'Someone';
  }

  return context;
}

async function resolveTicketForEmail(ticket) {
  const hasNames = ticket.createdBy && typeof ticket.createdBy === 'object' && ticket.createdBy.name;
  if (hasNames) return ticket;
  const id = ticket._id ?? ticket.id;
  return Ticket.findById(id).populate(EMAIL_TICKET_POPULATE);
}

/** `note`/`reason` carry internal judgement (close reasons, QA rejections) about
 * the client's own ticket — never in an external recipient's email context. */
function stripExternalContext(context) {
  const { note: _note, reason: _reason, ...safe } = context;
  return safe;
}

async function fanOut(eventKey, ticket, actor, context, config, deps, { hideFromExternal = false } = {}) {
  const recipients = await getNotificationRecipients(eventKey, ticket, actor, context);
  if (recipients.length === 0) return;

  // An internal comment must not surface to an external recipient on ANY
  // channel — not even as "someone commented" — so they are dropped entirely
  // before either channel runs, rather than merely having context stripped.
  const visible = hideFromExternal
    ? recipients.filter((r) => !isExternalUser(r.user))
    : recipients;
  if (visible.length === 0) return;

  const emailTicket = await resolveTicketForEmail(ticket);

  await createInAppNotifications(eventKey, ticket, visible, config);

  // Context is built ONCE per event and would otherwise be shared verbatim
  // across every recipient's email. Split it here, at send time, rather than
  // threading a per-recipient context through sendTicketEmail/renderTicketEmail.
  const internalRecipients = visible.filter((r) => !isExternalUser(r.user));
  const externalRecipients = visible.filter((r) => isExternalUser(r.user));

  if (internalRecipients.length) {
    await sendTicketEmail(eventKey, emailTicket, internalRecipients, context, config, deps);
  }
  if (externalRecipients.length) {
    await sendTicketEmail(
      eventKey, emailTicket, externalRecipients, stripExternalContext(context), config, deps,
    );
  }
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

    await fanOut(event.type, ticket, actor, context, config, deps, {
      hideFromExternal: commentIsInternal,
    });

    // TICKET_MENTIONED is its OWN fan-out with its own recipient set and its own
    // preference key — it never unions the comment audience, or mentioning one
    // person notifies the whole ticket twice.
    if (event.type === 'TICKET_COMMENTED' && event.mentions?.length) {
      await fanOut(
        'TICKET_MENTIONED', ticket, actor,
        { ...context, mentions: event.mentions }, config, deps,
        { hideFromExternal: commentIsInternal },
      );
    }
  } catch (err) {
    logger.error('Notification dispatch failed', {
      error: err.message, event: event?.type, ticket: ticket?.ticketId,
    });
  }
}

async function sendPlain(config, deps, message) {
  if (!config.features.email) {
    logger.warn('Email is not configured; message not sent', { subject: message.subject });
    return;
  }

  const transport = deps.transport ?? getTransport(config);
  try {
    await transport.sendMail({
      from: config.email.from,
      attachments: brandAttachments(config),
      ...message,
    });
  } catch (err) {
    // Never fails the request that triggered it — an invite that did not send is
    // resendable; a 500 on user creation is not recoverable by the admin.
    logger.error('Transactional email failed', { error: err.message, to: message.to });
  }
}

/** Invite and reset mail, on the same pooled transport as everything else. */
export function buildInviteDeliverer(config, deps = {}) {
  return async ({ user, inviteToken }) => {
    const link = `${config.frontendBaseUrl}/invite/accept?token=${inviteToken}`;
    const { subject, text, html } = renderInviteEmail({
      link,
      recipientEmail: user.email,
    });
    await sendPlain(config, deps, {
      to: user.email,
      subject,
      text,
      html,
    });
  };
}

export function buildResetDeliverer(config, deps = {}) {
  return async ({ user, resetToken }) => {
    const link = `${config.frontendBaseUrl}/reset-password?token=${resetToken}`;
    const { subject, text, html } = renderPasswordResetEmail({
      link,
      recipientName: user.name,
    });
    await sendPlain(config, deps, {
      to: user.email,
      subject,
      text,
      html,
    });
  };
}
