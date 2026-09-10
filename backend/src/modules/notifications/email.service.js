import { randomUUID } from 'node:crypto';
import { isExternalUser } from '@pms/shared';
import { renderTicketEmail, ticketEmailSubject } from '../../platform/email/templates/index.js';
import { brandAttachments, BrandLogoRequiredError } from '../../platform/email/logo.js';
import { brandedFrom, ticketBranding } from './branding.js';
import logger from '../../platform/logger.js';
import { getTransport } from '../../platform/mailer.js';
import EmailLog from './emailLog.model.js';
import TransactionalEmailLog from './transactionalEmailLog.model.js';

export const EMAIL_MAX_ATTEMPTS = 3;
const DEFAULT_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_LIMIT = 100;

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function ticketTestSinkAddress(config) {
  if (config?.email?.testSinkEnabled !== true) return '';
  return optionalString(config?.email?.testSinkTo);
}

/**
 * An external recipient sees their own company or nothing at all: no client
 * name, or a name whose logo will not resolve, fails the send rather than
 * putting the vendor's mark in front of a client.
 */
function requiresClientBrand(recipients) {
  return recipients.some((recipient) => isExternalUser(recipient.user));
}

function assertClientBrand(required, context) {
  if (!required) return;
  if (optionalString(context?.brandName) === '') {
    throw new BrandLogoRequiredError(
      'Client brand name is required for external ticket emails',
    );
  }
}

async function failRowsForPolicy(rows, error) {
  if (!rows.length) return;
  const now = new Date();
  await EmailLog.updateMany(
    { _id: { $in: rows.map((row) => row._id) } },
    {
      $set: {
        status: 'failed',
        lastAttemptAt: now,
        error,
      },
      $inc: { attemptCount: 1 },
    },
  );
}


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
  const { text, html } = renderTicketEmail(event, ticket, context, config);
  return { text, html };
}

export class TransactionalEmailDeliveryError extends Error {
  constructor(message, { logId = null } = {}) {
    super(message);
    this.name = 'TransactionalEmailDeliveryError';
    this.logId = logId;
  }
}

async function attempt(row, transport, config, attachments, bcc = null) {
  const now = new Date();
  try {
    await transport.sendMail({
      from: row.from,
      to: row.to,
      bcc: bcc ? [bcc] : undefined,
      cc: row.cc?.length ? row.cc : undefined,
      subject: row.subject,
      messageId: row.messageId,
      text: row.text,
      html: row.html,
      // The brand mark rides along as an inline attachment; the layout renders
      // it as cid:brand-mark so it survives remote-image blocking. The id is
      // deliberately vendor-neutral: it travels in the raw MIME of every
      // client's mail, where a product name has no business being.
      attachments,
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

async function attemptTransactional(row, transport, attachments) {
  const now = new Date();
  try {
    await transport.sendMail({
      from: row.from,
      to: row.to,
      cc: row.cc?.length ? row.cc : undefined,
      subject: row.subject,
      text: row.text,
      html: row.html,
      attachments,
    });
    await TransactionalEmailLog.updateOne({ _id: row._id }, {
      $set: { status: 'sent', sentAt: now, lastAttemptAt: now, error: null },
      $inc: { attemptCount: 1 },
    });
    return { ok: true, error: null };
  } catch (err) {
    await TransactionalEmailLog.updateOne({ _id: row._id }, {
      $set: { status: 'failed', lastAttemptAt: now, error: String(err.message || err) },
      $inc: { attemptCount: 1 },
    });
    logger.error('Transactional email send failed', {
      transactionalEmailLogId: String(row._id),
      error: err.message,
      kind: row.kind,
      to: row.to?.[0],
    });
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * The outbox: rows are written `pending` BEFORE the send, then flipped.
 *
 * This is AT-LEAST-ONCE delivery, and SMTP cannot give exactly-once. The window
 * is real: pending -> SMTP accepts -> process dies -> row still pending ->
 * retry -> the recipient receives it twice. What bounds the damage is the
 * deterministic Message-ID, the attempt cap and the grace period Ã¢â‚¬â€ not a claim
 * that the window does not exist.
 */
export async function sendTicketEmail(event, ticket, recipients, context, config, deps = {}) {
  if (!config.features.email) return { skipped: true, sent: 0, failed: 0 };

  const transport = deps.transport ?? getTransport(config);
  if (!transport) return { skipped: true, sent: 0, failed: 0 };

  const wanted = recipients.filter((r) => r.channels.email);
  if (wanted.length === 0) return { skipped: false, eventId: null, sent: 0, failed: 0 };

  const fallbackBranding = ticketBranding(ticket, config);
  const mergedBranding = context.brandLogoKey ? null : fallbackBranding;
  const renderedContext = mergedBranding ? { ...context, ...mergedBranding } : context;
  const requireBrandLogo = requiresClientBrand(wanted);

  const eventId = deps.eventId ?? randomUUID().replace(/-/g, '');
  const domain = domainOf(config);
  const from = brandedFrom(config, renderedContext.brandName);
  const subject = ticketEmailSubject(event, ticket, renderedContext);
  const { text, html } = renderBody(event, ticket, renderedContext, config);
  const sinkTo = deps.allowTestSink === false ? '' : ticketTestSinkAddress(config).toLowerCase();

  const rows = await EmailLog.insertMany(wanted.map((r) => ({
    eventId,
    event,
    ticket: ticket._id,
    recipientUserId: r.user._id,
    to: [r.user.email],
    from,
    subject,
    template: event.toLowerCase(),
    status: 'pending',
    messageId: messageIdFor(eventId, String(r.user._id), domain),
    requestId: context.requestId,
    renderSnapshot: {
      context: renderedContext,
      text,
      html,
      brandLogoKey: renderedContext.brandLogoKey || null,
      requireBrandLogo,
    },
  })));

  let attachments;
  try {
    assertClientBrand(requireBrandLogo, renderedContext);
    attachments = await brandAttachments(config, {
      logoKey: renderedContext.brandLogoKey,
      requireCompanyMark: requireBrandLogo,
    });
  } catch (err) {
    const error = String(err?.message || err);
    await failRowsForPolicy(rows, error);
    logger.error('Ticket email blocked by branding policy', {
      event,
      ticket: ticket?.ticketId,
      eventId,
      error,
      externalRecipients: true,
    });
    return { skipped: false, eventId, sent: 0, failed: rows.length };
  }

  let sent = 0;
  let failed = 0;
  for (const [index, row] of rows.entries()) {
    const rowTo = optionalString(row.to?.[0]).toLowerCase();
    const testBcc = index === 0 && sinkTo && sinkTo !== rowTo ? sinkTo : null;
    const ok = await attempt(
      { ...row.toObject(), text, html },
      transport,
      config,
      attachments,
      testBcc,
    );
    if (ok) sent += 1; else failed += 1;
  }

  return { skipped: false, eventId, sent, failed };
}

/**
 * The sweep. Only rows older than the grace period are picked up, long enough
 * that a row mid-flight in a healthy process is never touched. After the cap
 * the row stays `failed` and stops — no unbounded loop hammering a mailbox.
 */
export async function retryPendingEmails(config, deps = {}, options = {}) {
  if (!config.features.email) return { attempted: 0, sent: 0, failed: 0 };

  const transport = deps.transport ?? getTransport(config);
  if (!transport) return { attempted: 0, sent: 0, failed: 0 };

  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const maxAttempts = options.maxAttempts ?? EMAIL_MAX_ATTEMPTS;
  const limit = options.limit ?? DEFAULT_RETRY_LIMIT;
  const cutoff = new Date(Date.now() - graceMs);

  // Cap is sticky: a row that already used its attempts is failed, not retried forever.
  await EmailLog.updateMany(
    { status: { $in: ['pending', 'failed'] }, attemptCount: { $gte: maxAttempts } },
    { $set: { status: 'failed' } },
  );

  const rows = await EmailLog.find({
    status: { $in: ['pending', 'failed'] },
    attemptCount: { $lt: maxAttempts },
    $or: [{ lastAttemptAt: { $lt: cutoff } }, { lastAttemptAt: null, createdAt: { $lt: cutoff } }],
  }).sort({ createdAt: 1 }).limit(limit)
    .populate({ path: 'recipientUserId', select: 'role roles' })
    .populate({
      path: 'ticket',
      populate: {
        path: 'project',
        select: 'brand client',
        populate: { path: 'client', select: 'name logoKey' },
      },
    });

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const snapshot = row.renderSnapshot ?? null;
    const hasSnapshotBody = typeof snapshot?.text === 'string' && typeof snapshot?.html === 'string';
    const ticket = row.ticket ?? { ticketId: '', title: '' };
    const currentBranding = ticketBranding(ticket, config) ?? {};
    const context = hasSnapshotBody ? (snapshot.context ?? {}) : currentBranding;
    const { text, html } = hasSnapshotBody
      ? { text: snapshot.text, html: snapshot.html }
      : renderBody(row.event, ticket, context, config);
    // Rows written before this policy existed carry no flag; fall back to the
    // recipient's own role rather than assuming the send was already cleared.
    const requireBrandLogo = typeof snapshot?.requireBrandLogo === 'boolean'
      ? snapshot.requireBrandLogo
      : isExternalUser(row.recipientUserId ?? {});
    let attachments;
    try {
      assertClientBrand(requireBrandLogo, context);
      attachments = await brandAttachments(config, {
        logoKey: snapshot?.brandLogoKey || context.brandLogoKey || currentBranding.brandLogoKey,
        requireCompanyMark: requireBrandLogo,
      });
    } catch (err) {
      if (!(err instanceof BrandLogoRequiredError)) throw err;
      const error = String(err.message || err);
      await failRowsForPolicy([row], error);
      logger.error('Ticket email retry blocked by branding policy', {
        emailLogId: String(row._id),
        ticket: ticket?.ticketId,
        error,
      });
      failed += 1;
      continue;
    }
    const ok = await attempt({ ...row.toObject(), text, html }, transport, config, attachments);
    if (ok) sent += 1; else failed += 1;
  }

  return { attempted: rows.length, sent, failed };
}

export async function sendTransactionalEmail(kind, message, config, deps = {}, options = {}) {
  const to = Array.isArray(message?.to) ? message.to : [message?.to].filter(Boolean);
  const cc = Array.isArray(message?.cc) ? message.cc : [message?.cc].filter(Boolean);
  const row = await TransactionalEmailLog.create({
    kind,
    to,
    cc,
    from: brandedFrom(config, message?.brandName) || '',
    subject: message?.subject || '',
    text: message?.text || '',
    html: message?.html || '',
    // Stored, not just used: a retry days later must send the same client's
    // mark, and the caller's branding lookup is long gone by then.
    brandLogoKey: optionalString(message?.brandLogoKey) || null,
    status: 'pending',
    requestId: options.requestId,
  });

  const fail = async (error) => {
    await TransactionalEmailLog.updateOne(
      { _id: row._id },
      { $set: { status: 'failed', error, lastAttemptAt: new Date() } },
    );
    if (options.throwOnError) {
      throw new TransactionalEmailDeliveryError(error, { logId: String(row._id) });
    }
    return { sent: false, queued: true, logId: String(row._id), error };
  };

  if (!config?.features?.email) {
    return fail('Email capability is disabled');
  }

  const transport = deps.transport ?? getTransport(config);
  if (!transport) {
    return fail('SMTP transport is unavailable');
  }

  // Not fail-closed like ticket mail: an invite or a reset link that never
  // arrives locks the person out, which is worse than a neutral mark.
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments
    : await brandAttachments(config, { logoKey: message?.brandLogoKey });
  const result = await attemptTransactional({ ...row.toObject(), to, cc }, transport, attachments);
  if (!result.ok && options.throwOnError) {
    throw new TransactionalEmailDeliveryError(result.error, { logId: String(row._id) });
  }

  return {
    sent: result.ok,
    queued: !result.ok,
    logId: String(row._id),
    error: result.error,
  };
}

export async function retryPendingTransactionalEmails(config, deps = {}, options = {}) {
  if (!config.features.email) return { attempted: 0, sent: 0, failed: 0 };

  const transport = deps.transport ?? getTransport(config);
  if (!transport) return { attempted: 0, sent: 0, failed: 0 };

  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const maxAttempts = options.maxAttempts ?? EMAIL_MAX_ATTEMPTS;
  const limit = options.limit ?? DEFAULT_RETRY_LIMIT;
  const cutoff = new Date(Date.now() - graceMs);

  await TransactionalEmailLog.updateMany(
    { status: { $in: ['pending', 'failed'] }, attemptCount: { $gte: maxAttempts } },
    { $set: { status: 'failed' } },
  );

  const rows = await TransactionalEmailLog.find({
    status: { $in: ['pending', 'failed'] },
    attemptCount: { $lt: maxAttempts },
    $or: [{ lastAttemptAt: { $lt: cutoff } }, { lastAttemptAt: null, createdAt: { $lt: cutoff } }],
  }).sort({ createdAt: 1 }).limit(limit);

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    // Per row, not once for the batch: two queued rows can belong to two
    // different clients and must not share one mark.
    const attachments = await brandAttachments(config, { logoKey: row.brandLogoKey });
    const result = await attemptTransactional(row.toObject(), transport, attachments);
    if (result.ok) sent += 1; else failed += 1;
  }

  return { attempted: rows.length, sent, failed };
}

