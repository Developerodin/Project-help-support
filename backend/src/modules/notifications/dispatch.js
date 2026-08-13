import { NOTIFICATION_EVENTS } from '@pms/shared';
import logger from '../../platform/logger.js';
import { getTransport } from '../../platform/mailer.js';
import { getNotificationRecipients } from './recipients.js';
import { createInAppNotifications } from './notification.service.js';
import { sendTicketEmail } from './email.service.js';

async function fanOut(eventKey, ticket, actor, context, config, deps) {
  const recipients = await getNotificationRecipients(eventKey, ticket, actor, context);
  if (recipients.length === 0) return;

  await createInAppNotifications(eventKey, ticket, recipients, config);
  await sendTicketEmail(eventKey, ticket, recipients, context, config, deps);
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

    const context = {
      from: event.from,
      to: event.to,
      note: event.note,
      reason: event.reason,
      requestId: event.requestId,
    };

    await fanOut(event.type, ticket, actor, context, config, deps);

    // TICKET_MENTIONED is its OWN fan-out with its own recipient set and its own
    // preference key — it never unions the comment audience, or mentioning one
    // person notifies the whole ticket twice.
    if (event.type === 'TICKET_COMMENTED' && event.mentions?.length) {
      await fanOut(
        'TICKET_MENTIONED', ticket, actor,
        { ...context, mentions: event.mentions }, config, deps,
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
    await transport.sendMail({ from: config.email.from, ...message });
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
    await sendPlain(config, deps, {
      to: user.email,
      subject: 'You have been invited',
      text: `You have been invited.\n\nSet your password: ${link}\n\nThis link expires in 72 hours.`,
    });
  };
}

export function buildResetDeliverer(config, deps = {}) {
  return async ({ user, resetToken }) => {
    const link = `${config.frontendBaseUrl}/reset-password?token=${resetToken}`;
    await sendPlain(config, deps, {
      to: user.email,
      subject: 'Reset your password',
      text: `Reset your password: ${link}\n\nThis link expires in 2 hours.`,
    });
  };
}
