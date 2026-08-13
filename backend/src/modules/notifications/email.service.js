import { randomUUID } from 'node:crypto';
import { stageLabel } from '@pms/shared';
import logger from '../../platform/logger.js';
import { getTransport } from '../../platform/mailer.js';
import EmailLog from './emailLog.model.js';

export const EMAIL_MAX_ATTEMPTS = 3;
const DEFAULT_GRACE_MS = 5 * 60 * 1000;

const SUBJECTS = {
  TICKET_CREATED: (t) => `[${t.ticketId}] Filed: ${t.title}`,
  TICKET_ASSIGNED: (t) => `[${t.ticketId}] Assigned: ${t.title}`,
  TICKET_STAGE_CHANGED: (t, c) => `[${t.ticketId}] ${stageLabel(c.to)}: ${t.title}`,
  TICKET_REOPENED: (t) => `[${t.ticketId}] Reopened: ${t.title}`,
  TICKET_CLOSED: (t) => `[${t.ticketId}] Closed: ${t.title}`,
  TICKET_COMMENTED: (t) => `[${t.ticketId}] New comment: ${t.title}`,
  TICKET_MENTIONED: (t) => `[${t.ticketId}] You were mentioned: ${t.title}`,
  TICKET_ESTIMATE_SET: (t) => `[${t.ticketId}] Estimates updated: ${t.title}`,
};

function domainOf(config) {
  const match = String(config.email?.from || '').match(/@([^>\s]+)/);
  if (match) return match[1];
  try {
    return new URL(config.frontendBaseUrl).hostname;
  } catch {
    return 'localhost';
  }
}

/**
 * Deterministic per (fan-out, recipient), so a resend carries the SAME id.
 * Compliant clients and most servers collapse duplicate Message-IDs, which
 * usually deduplicates a retry at the recipient. "Usually" is the honest word:
 * this is mitigation, not a guarantee.
 */
export function messageIdFor(eventId, recipientUserId, domain) {
  return `<${eventId}.${recipientUserId}@${domain}>`;
}

function renderBody(event, ticket, context, config) {
  const link = `${config.frontendBaseUrl}/tickets?ticket=${ticket.ticketId}`;
  const rows = [];

  if (context.to) rows.push(`Stage: ${stageLabel(context.from)} -> ${stageLabel(context.to)}`);
  if (context.note) rows.push(`Note: ${context.note}`);
  if (context.reason) rows.push(`Reason: ${context.reason}`);

  const text = [
    `${ticket.ticketId}: ${ticket.title}`,
    ...rows,
    '',
    link,
    '',
    'Attachment links in this email are presigned and expire shortly after sending.',
  ].join('\n');

  const html = `<p><strong>${ticket.ticketId}</strong>: ${ticket.title}</p>`
    + rows.map((r) => `<p>${r}</p>`).join('')
    + `<p><a href="${link}">Open the ticket</a></p>`
    + '<p style="color:#666;font-size:12px">Attachment links in this email are presigned '
    + 'and expire shortly after sending.</p>';

  return { text, html };
}

async function attempt(row, transport) {
  const now = new Date();
  try {
    await transport.sendMail({
      from: row.from,
      to: row.to,
      cc: row.cc?.length ? row.cc : undefined,
      subject: row.subject,
      messageId: row.messageId,
      text: row.text,
      html: row.html,
    });

    await EmailLog.updateOne({ _id: row._id }, {
      $set: { status: 'sent', sentAt: now, lastAttemptAt: now, error: null },
      $inc: { attemptCount: 1 },
    });
    return true;
  } catch (err) {
    await EmailLog.updateOne({ _id: row._id }, {
      $set: { status: 'failed', lastAttemptAt: now, error: String(err.message || err) },
      $inc: { attemptCount: 1 },
    });
    logger.error('Email send failed', { emailLogId: String(row._id), error: err.message });
    return false;
  }
}

/**
 * The outbox: rows are written `pending` BEFORE the send, then flipped.
 *
 * This is AT-LEAST-ONCE delivery, and SMTP cannot give exactly-once. The window
 * is real: pending -> SMTP accepts -> process dies -> row still pending ->
 * retry -> the recipient receives it twice. What bounds the damage is the
 * deterministic Message-ID, the attempt cap and the grace period â€” not a claim
 * that the window does not exist.
 */
export async function sendTicketEmail(event, ticket, recipients, context, config, deps = {}) {
  if (!config.features.email) return { skipped: true, sent: 0, failed: 0 };

  const transport = deps.transport ?? getTransport(config);
  if (!transport) return { skipped: true, sent: 0, failed: 0 };

  const wanted = recipients.filter((r) => r.channels.email);
  if (wanted.length === 0) return { skipped: false, eventId: null, sent: 0, failed: 0 };

  const eventId = deps.eventId ?? randomUUID().replace(/-/g, '');
  const domain = domainOf(config);
  const subject = (SUBJECTS[event] ?? ((t) => `[${t.ticketId}] ${t.title}`))(ticket, context);
  const { text, html } = renderBody(event, ticket, context, config);

  const rows = await EmailLog.insertMany(wanted.map((r) => ({
    eventId,
    event,
    ticket: ticket._id,
    recipientUserId: r.user._id,
    to: [r.user.email],
    from: config.email.from,
    subject,
    template: event.toLowerCase(),
    status: 'pending',
    messageId: messageIdFor(eventId, String(r.user._id), domain),
    requestId: context.requestId,
  })));

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    // text/html are not persisted â€” a retry re-renders them from the ticket,
    // which is the source of truth for what the email should say.
    const ok = await attempt({ ...row.toObject(), text, html }, transport);
    if (ok) sent += 1; else failed += 1;
  }

  return { skipped: false, eventId, sent, failed };
}

/**
 * The sweep. Only rows older than the grace period are picked up, long enough
 * that a row mid-flight in a healthy process is never touched. After the cap
 * the row stays `failed` and stops â€” no unbounded loop hammering a mailbox.
 */
export async function retryPendingEmails(config, deps = {}, options = {}) {
  if (!config.features.email) return { attempted: 0, sent: 0 };

  const transport = deps.transport ?? getTransport(config);
  if (!transport) return { attempted: 0, sent: 0 };

  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const maxAttempts = options.maxAttempts ?? EMAIL_MAX_ATTEMPTS;
  const cutoff = new Date(Date.now() - graceMs);

  // Cap is sticky: a pending row that already used its attempts is failed, not
  // retried forever if something flips status back to pending.
  await EmailLog.updateMany(
    { status: 'pending', attemptCount: { $gte: maxAttempts } },
    { $set: { status: 'failed' } },
  );

  const rows = await EmailLog.find({
    status: 'pending',
    attemptCount: { $lt: maxAttempts },
    $or: [{ lastAttemptAt: { $lt: cutoff } }, { lastAttemptAt: null, createdAt: { $lt: cutoff } }],
  }).limit(100).populate('ticket');

  let sent = 0;
  for (const row of rows) {
    const ticket = row.ticket ?? { ticketId: '', title: '' };
    const { text, html } = renderBody(row.event, ticket, {}, config);
    const ok = await attempt({ ...row.toObject(), text, html }, transport);
    if (ok) sent += 1;
  }

  return { attempted: rows.length, sent };
}
