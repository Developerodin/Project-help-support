import { randomUUID } from 'node:crypto';
import { isExternalUser } from '@pms/shared';
import {
  renderTicketDigestEmail, renderTicketEmail, renderTicketSummaryEmail, ticketEmailSubject,
} from '../../platform/email/templates/index.js';
import { brandAttachments, BrandLogoRequiredError } from '../../platform/email/logo.js';
import { brandedFrom, ticketBranding } from './branding.js';
import logger from '../../platform/logger.js';
import { getTransport } from '../../platform/mailer.js';
import Ticket from '../tickets/ticket.model.js';
import User from '../users/user.model.js';
import EmailLog from './emailLog.model.js';
import Notification from './notification.model.js';
import TransactionalEmailLog from './transactionalEmailLog.model.js';
import { canUserViewTicket, resolvePreference } from './recipients.js';
import TicketMute from './ticketMute.model.js';
import { deliveryPrefs, routineHoldUntil } from './delivery-schedule.js';
import { unsubscribeLinks } from './unsubscribe.js';

export const EMAIL_MAX_ATTEMPTS = 3;
const DEFAULT_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_LIMIT = 100;
const DEFAULT_BATCH_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_MAX_MS = 15 * 60 * 1000;

/** What a ticket email needs populated: names for the facts, client for the brand. */
export const EMAIL_TICKET_POPULATE = [
  'assignedTo',
  'createdBy',
  {
    path: 'project',
    select: 'client brand',
    populate: { path: 'client', select: 'name status logoKey' },
  },
];

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

/** `counted`: the sweep's claim already bumped attemptCount for this try. */
async function failRowsForPolicy(rows, error, { counted = false } = {}) {
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
      ...(counted ? {} : { $inc: { attemptCount: 1 } }),
    },
  );
}

/**
 * Rows a sweep may pick up. `sending` is included because a claim stamps
 * lastAttemptAt = now: a live claim is inside the grace window and invisible,
 * while one whose process died before finishing ages out of it and is retried.
 */
function retryableFilter(maxAttempts, cutoff) {
  return {
    status: { $in: ['pending', 'failed', 'sending'] },
    attemptCount: { $lt: maxAttempts },
    $or: [{ lastAttemptAt: { $lt: cutoff } }, { lastAttemptAt: null, createdAt: { $lt: cutoff } }],
    // A batch claimed but never rendered has no snapshot to resend, and
    // re-rendering it from row.event would send one event, not the batch. The
    // flush owns those (see flushableFilter). Matches nothing on other models.
    $nor: [{ 'batch.0': { $exists: true }, 'renderSnapshot.text': { $exists: false } }],
  };
}

/** Out of attempts. A `sending` row only counts once its claim has gone stale. */
function exhaustedFilter(maxAttempts, cutoff) {
  return {
    attemptCount: { $gte: maxAttempts },
    $or: [
      { status: { $in: ['pending', 'failed'] } },
      { status: 'sending', lastAttemptAt: { $lt: cutoff } },
    ],
  };
}

/**
 * The claim is the only thing standing between two sweeps (two instances, or a
 * boot replay overlapping an interval tick) and a duplicate send: whichever
 * findOneAndUpdate matches first owns the row, the other gets null. The
 * attempt is counted here, so a row that crashes its process every time still
 * hits the cap instead of looping forever.
 */
function claimRow(Model, id, maxAttempts, cutoff) {
  return Model.findOneAndUpdate(
    { _id: id, ...retryableFilter(maxAttempts, cutoff) },
    { $set: { status: 'sending', lastAttemptAt: new Date() }, $inc: { attemptCount: 1 } },
    { new: true },
  );
}

/** Never retried again: attemptCount is lifted to the cap. */
function abandonRow(Model, id, maxAttempts, error, extraSet = {}) {
  return Model.updateOne(
    { _id: id },
    { $set: { status: 'failed', error, ...extraSet }, $max: { attemptCount: maxAttempts } },
  );
}

/**
 * Invite and reset bodies carry a live token link. Once a row can no longer be
 * sent (delivered, or out of attempts) the body has no further use, so it is
 * overwritten rather than kept for the 90-day (or, when failed, open-ended) log.
 */
const REDACTED_BODY = { text: '[redacted]', html: '[redacted]' };

const INACTIVE_RECIPIENT = 'Recipient is no longer active';
const EMAIL_PAUSED = 'Recipient paused ticket email';

/** The reader's opt-out links, merged into the render context (see shared/email/ticket.js). */
function withOptOutLinks(context, userId, config) {
  const { manageUrl, unsubscribeUrl, listUnsubscribe } = unsubscribeLinks(userId, config);
  return { context: { ...context, manageUrl, unsubscribeUrl }, listUnsubscribe };
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

/**
 * The thread root every email about one ticket replies to. No message ever
 * carries this id; clients thread on the shared References (and the stable
 * subject) regardless, so each ticket reads as one conversation.
 */
export function threadIdFor(ticketObjectId, domain) {
  return `<ticket.${ticketObjectId}@${domain}>`;
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

async function attempt(row, transport, config, attachments, bcc = null, { counted = false } = {}) {
  const now = new Date();
  const inc = counted ? {} : { $inc: { attemptCount: 1 } };
  try {
    await transport.sendMail({
      from: row.from,
      to: row.to,
      bcc: bcc ? [bcc] : undefined,
      cc: row.cc?.length ? row.cc : undefined,
      subject: row.subject,
      messageId: row.messageId,
      inReplyTo: row.threadId || undefined,
      references: row.threadId || undefined,
      // Stored on the row, so a retry carries the same one-click unsubscribe.
      headers: row.listUnsubscribe
        ? { 'List-Unsubscribe': row.listUnsubscribe, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
        : undefined,
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
      ...inc,
    });
    return true;
  } catch (err) {
    await EmailLog.updateOne({ _id: row._id }, {
      $set: { status: 'failed', lastAttemptAt: now, error: String(err.message || err) },
      ...inc,
    });
    logger.error('Email send failed', { emailLogId: String(row._id), error: err.message });
    return false;
  }
}

async function attemptTransactional(row, transport, attachments, { counted = false } = {}) {
  const now = new Date();
  const inc = counted ? {} : { $inc: { attemptCount: 1 } };
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
      $set: { status: 'sent', sentAt: now, lastAttemptAt: now, error: null, ...REDACTED_BODY },
      ...inc,
    });
    return { ok: true, error: null };
  } catch (err) {
    await TransactionalEmailLog.updateOne({ _id: row._id }, {
      $set: { status: 'failed', lastAttemptAt: now, error: String(err.message || err) },
      ...inc,
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
  const subject = ticketEmailSubject(ticket);
  const threadId = threadIdFor(ticket._id, domain);
  // Rendered per recipient: each footer carries that reader's own signed
  // unsubscribe link. Cheap next to the SMTP call each one already costs.
  const rendered = wanted.map((r) => {
    const { context: readerContext, listUnsubscribe } = withOptOutLinks(renderedContext, r.user._id, config);
    return { readerContext, listUnsubscribe, ...renderBody(event, ticket, readerContext, config) };
  });

  const rows = await EmailLog.insertMany(wanted.map((r, i) => ({
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
    threadId,
    listUnsubscribe: rendered[i].listUnsubscribe,
    requestId: context.requestId,
    renderSnapshot: {
      context: rendered[i].readerContext,
      text: rendered[i].text,
      html: rendered[i].html,
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
  for (const [i, row] of rows.entries()) {
    const ok = await attempt(
      { ...row.toObject(), text: rendered[i].text, html: rendered[i].html },
      transport,
      config,
      attachments,
      null,
    );
    if (ok) sent += 1; else failed += 1;
  }

  if (sent > 0) {
    await sendTestSinkCopy(transport, config, deps, {
      from, subject, text: rendered[0].text, html: rendered[0].html, attachments,
    }, { event, ticket: ticket?.ticketId, eventId });
  }

  return { skipped: false, eventId, sent, failed };
}

async function sendTestSinkCopy(transport, config, deps, message, logContext) {
  const sinkTo = deps.allowTestSink === false ? '' : ticketTestSinkAddress(config).toLowerCase();
  if (!sinkTo || config.isProduction) return;
  try {
    await transport.sendMail({
      ...message,
      to: sinkTo,
      subject: `[notification-test-sink] ${message.subject}`,
    });
  } catch (err) {
    logger.warn('Ticket notification test sink copy failed', { ...logContext, error: err.message });
  }
}

/**
 * Adds one routine event to the recipient's open batch for this ticket,
 * starting one if there is none. Each event pushes the send back to now +
 * window, but never past the deadline set when the batch was opened.
 *
 * A held batch is different: `recipient` (the user) lets their hourly/daily
 * slot or quiet hours hold it (routineHoldUntil), and `holdUntil` holds it
 * outright (an urgent event deferred to the end of quiet hours). A hold sets
 * sendAfter AND the deadline to that time, and only ever moves them later
 * ($max): a batch already due sooner is pushed back, never pulled forward.
 * So a person who switches to daily keeps their already-queued batches until
 * the next event on that ticket joins one and moves it to the new slot. An
 * event arriving in the ~30s between a slot passing and the flush picking
 * the row up moves the whole row to the next slot — late, never lost.
 *
 * The unique partial index allows one `queued` row per (recipient, ticket), so
 * two events landing at once cannot open two batches: the loser of the insert
 * race gets E11000 and its retry appends to the winner's row. Failure mode:
 * a crash between the append and the $min fix-up leaves sendAfter up to one
 * window past the deadline; the email is late, never lost.
 */
export async function enqueueTicketEmail(recipientUserId, ticket, item, config, {
  now = new Date(), recipient = null, holdUntil = null,
} = {}) {
  if (!config.features.email) return null;

  const windowMs = config.email?.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS;
  const maxMs = config.email?.batchMaxMs ?? DEFAULT_BATCH_MAX_MS;
  const hold = holdUntil
    ?? (recipient ? routineHoldUntil(recipient, config, now, new Date(now.getTime() + windowMs)) : null);
  const schedule = hold
    ? { $max: { sendAfter: hold, batchDeadline: hold } }
    : { $set: { sendAfter: new Date(now.getTime() + windowMs) } };
  const domain = domainOf(config);
  const append = () => {
    const eventId = randomUUID().replace(/-/g, '');
    return EmailLog.findOneAndUpdate(
      { recipientUserId, ticket: ticket._id, status: 'queued' },
      {
        $push: { batch: { ...item, at: now } },
        ...schedule,
        $setOnInsert: {
          eventId,
          event: item.event,
          ...(hold ? {} : { batchDeadline: new Date(now.getTime() + maxMs) }),
          messageId: messageIdFor(eventId, String(recipientUserId), domain),
          threadId: threadIdFor(ticket._id, domain),
          requestId: item.context?.requestId,
        },
      },
      { upsert: true, new: true },
    );
  };

  let row;
  try {
    row = await append();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    row = await append();
  }
  if (row.sendAfter > row.batchDeadline) {
    await EmailLog.updateOne({ _id: row._id, status: 'queued' }, { $min: { sendAfter: row.batchDeadline } });
  }
  return row;
}

/**
 * Mentions and "assigned to you" go out now. If the recipient has an open
 * batch on this ticket it is claimed (atomically, so a flush cannot also send
 * it) and goes out with the urgent event as one email; everyone else gets the
 * urgent event alone through the ordinary send path.
 */
export async function sendUrgentTicketEmail(event, ticket, recipients, context, config, deps = {}) {
  if (!config.features.email) return { skipped: true, sent: 0, failed: 0 };
  const transport = deps.transport ?? getTransport(config);
  if (!transport) return { skipped: true, sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const alone = [];
  for (const r of recipients.filter((x) => x.channels.email)) {
    const now = new Date();
    const item = {
      event, context, notificationId: deps.notificationIds?.get(String(r.user._id)), urgent: true, at: now,
    };
    const row = await EmailLog.findOneAndUpdate(
      { recipientUserId: r.user._id, ticket: ticket._id, status: 'queued' },
      { $push: { batch: item }, $set: { status: 'sending', lastAttemptAt: now }, $inc: { attemptCount: 1 } },
      { new: true },
    );
    if (!row) {
      alone.push(r);
      continue;
    }
    const outcome = await deliverBatchRow(row, config, { ...deps, transport });
    if (outcome === 'sent') sent += 1;
    if (outcome === 'failed') failed += 1;
  }

  if (alone.length) {
    const result = await sendTicketEmail(event, ticket, alone, context, config, { ...deps, transport });
    sent += result.sent;
    failed += result.failed;
  }
  return { skipped: false, sent, failed };
}

/** Due batches, plus batches claimed by a process that died before rendering them. */
function flushableFilter(now, cutoff, maxAttempts) {
  return {
    $or: [
      { status: 'queued', sendAfter: { $lte: now } },
      {
        status: 'sending',
        'batch.0': { $exists: true },
        'renderSnapshot.text': { $exists: false },
        attemptCount: { $lt: maxAttempts },
        lastAttemptAt: { $lt: cutoff },
      },
    ],
  };
}

/**
 * Sends every batch whose quiet window has lapsed. Each row is claimed
 * (queued -> sending, attempt counted) before anything else happens, so two
 * processes or an overlapping urgent send cannot both send it.
 *
 * Crash recovery: the snapshot is written before the SMTP call. A row that
 * dies after that is `sending` with a snapshot, and the retry sweep resends it
 * exactly as it resends any other row. A row that dies before it is `sending`
 * with no snapshot; the retry sweep leaves it alone and this flush claims it
 * again once the grace period has passed, re-running every check.
 *
 * ponytail: one pass sends at most `limit` batches, one after another. At a
 * 30s cadence that is ~200 emails a minute before batches start going out late.
 */
export async function flushDueEmailBatches(config, deps = {}, options = {}) {
  const idle = { attempted: 0, sent: 0, skipped: 0, failed: 0 };
  if (!config.features.email) return idle;
  const transport = deps.transport ?? getTransport(config);
  if (!transport) return idle;

  const now = options.now ?? new Date();
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const maxAttempts = options.maxAttempts ?? EMAIL_MAX_ATTEMPTS;
  const limit = options.limit ?? DEFAULT_RETRY_LIMIT;
  const due = flushableFilter(now, new Date(now.getTime() - graceMs), maxAttempts);

  const candidates = await EmailLog.find(due).sort({ sendAfter: 1 }).limit(limit)
    .select('_id recipientUserId').lean();
  const summaryUsers = new Set((await User.find({
    _id: { $in: [...new Set(candidates.map((c) => String(c.recipientUserId)))] },
    'notificationPrefs.emailFrequency': { $in: SUMMARY_FREQUENCIES },
  }).distinct('_id')).map(String));

  const result = idle;
  const summarized = new Set();
  for (const { _id, recipientUserId } of candidates) {
    const recipientKey = String(recipientUserId);
    if (summaryUsers.has(recipientKey)) {
      if (summarized.has(recipientKey)) continue;
      summarized.add(recipientKey);
      await flushSummary(recipientUserId, due, config, { ...deps, transport }, result);
      continue;
    }
    const row = await claimDueRow(_id, due);
    if (!row) continue; // an urgent send or another process took it
    result.attempted += 1;
    try {
      result[await deliverBatchRow(row, config, { ...deps, transport })] += 1;
    } catch (err) {
      result.failed += 1;
      logger.error('Email batch flush errored', { emailLogId: String(row._id), error: err.message });
    }
  }
  return result;
}

const SUMMARY_FREQUENCIES = ['hourly', 'daily'];

/** queued -> sending, attempt counted. Null when an urgent send or another process got there first. */
function claimDueRow(_id, due) {
  return EmailLog.findOneAndUpdate(
    { _id, ...due },
    { $set: { status: 'sending', lastAttemptAt: new Date() }, $inc: { attemptCount: 1 } },
    { new: true },
  );
}

/**
 * Every due batch of one hourly/daily recipient, as one summary email. Each
 * row is claimed on its own, exactly as a single batch is; a row another
 * flusher (or an urgent send) claimed first is simply not in this summary —
 * it goes out with that other send, so nothing is sent twice. Two flushers
 * racing can therefore split one person's slot into two summaries; neither
 * repeats a ticket.
 *
 * ponytail: every due row of the recipient in one go, no cap. A daily reader
 * following hundreds of busy tickets gets one long email and one slow flush
 * tick; cap the query and let the next tick send the rest if that happens.
 */
async function flushSummary(recipientUserId, due, config, deps, result) {
  const ids = await EmailLog.find({ ...due, recipientUserId }).sort({ sendAfter: 1 }).select('_id').lean();
  const rows = [];
  for (const { _id } of ids) {
    const row = await claimDueRow(_id, due);
    if (row) rows.push(row);
  }
  if (rows.length === 0) return;
  result.attempted += rows.length;
  try {
    const outcome = await deliverSummary(rows, config, deps);
    for (const key of ['sent', 'skipped', 'failed']) result[key] += outcome[key];
  } catch (err) {
    result.failed += rows.length;
    logger.error('Email summary flush errored', { recipientUserId: String(recipientUserId), error: err.message });
  }
}

/**
 * A -> B -> C becomes one A -> C move; A -> B -> A says nothing happened and
 * is dropped. The path in between is kept for the digest's stage line.
 */
function collapseStageMoves(items) {
  const moves = items.filter((item) => item.event === 'TICKET_STAGE_CHANGED');
  if (moves.length === 0) return items;
  const first = moves[0].context ?? {};
  const last = moves[moves.length - 1];
  if (first.from && first.from === last.context?.to) {
    return items.filter((item) => item.event !== 'TICKET_STAGE_CHANGED');
  }
  if (moves.length === 1) return items;
  const net = {
    ...last,
    context: {
      ...last.context,
      from: first.from,
      stagePath: [first.from, ...moves.map((move) => move.context?.to)].filter(Boolean),
    },
  };
  return items
    .filter((item) => item.event !== 'TICKET_STAGE_CHANGED' || item === last)
    .map((item) => (item === last ? net : item));
}

/**
 * What is still worth an email at send time: the recipient still wants mail
 * for that event, has not muted the ticket (urgent items excepted) and can
 * still open it, and has not already read it in-app (urgent items are sent
 * regardless). A previous assignee keeps their
 * "unassigned you" even without access, as the in-app row does.
 *
 * ponytail: one permission-context load per batch (canUserViewTicket), the
 * same cost the fan-out pays per recipient.
 */
async function itemsStillWorthSending(batch, user, ticket, { muted = false } = {}) {
  const canView = await canUserViewTicket(user, ticket);
  const notificationIds = batch.filter((item) => item.notificationId).map((item) => item.notificationId);
  const read = notificationIds.length
    ? await Notification.find({ _id: { $in: notificationIds }, readAt: { $ne: null } }).select('_id').lean()
    : [];
  const readIds = new Set(read.map((n) => String(n._id)));

  const kept = batch.filter((item) => {
    if (!resolvePreference(user, 'email', item.event)) return false;
    // Muted since it was queued: only what is addressed to them survives.
    if (muted && !item.urgent) return false;
    if (!canView && !item.context?.unassignedYou) return false;
    return item.urgent || !item.notificationId || !readIds.has(String(item.notificationId));
  });
  return collapseStageMoves([...kept].sort((a, b) => new Date(a.at) - new Date(b.at)));
}

function skipRow(row, reason) {
  return EmailLog.updateOne(
    { _id: row._id },
    { $set: { status: 'skipped', skippedAt: new Date(), error: reason } },
  );
}

/**
 * Every per-item check a batch row gets at send time, before anything is
 * rendered. Returns `{ skip: reason }` or `{ ticket, items }` with the ticket
 * populated for rendering.
 */
async function prepareBatchRow(row, user) {
  if (user?.status !== 'active') return { skip: INACTIVE_RECIPIENT };
  if (deliveryPrefs(user).emailPaused) return { skip: EMAIL_PAUSED };
  // Unpopulated at first: the visibility checks read refs the way the fan-out
  // passes them, and a populated project.client is not what they expect.
  const ticket = await Ticket.findById(row.ticket);
  if (!ticket) return { skip: 'Ticket no longer exists' };
  const muted = Boolean(await TicketMute.exists({ ticket: ticket._id, user: user._id }));
  const items = await itemsStillWorthSending(
    row.batch.map((item) => item.toObject?.() ?? item), user, ticket, { muted },
  );
  if (items.length === 0) return { skip: 'Nothing left to send' };
  await ticket.populate(EMAIL_TICKET_POPULATE);
  return { ticket, items };
}

function withTicketBranding(context, ticket, config) {
  return context?.brandLogoKey ? context : { ...context, ...(ticketBranding(ticket, config) ?? {}) };
}

/**
 * Renders and sends one claimed batch row. Returns 'sent', 'failed' or
 * 'skipped'. One item left renders exactly as that event's own email; more
 * than one renders the digest.
 */
async function deliverBatchRow(row, config, deps) {
  const user = await User.findById(row.recipientUserId);
  const prepared = await prepareBatchRow(row, user);
  if (prepared.skip) {
    await skipRow(row, prepared.skip);
    return 'skipped';
  }
  const { ticket, items } = prepared;

  const optOut = withOptOutLinks({}, user._id, config);
  const withBranding = (context = {}) => ({ ...withTicketBranding(context, ticket, config), ...optOut.context });
  const context = withBranding(items[items.length - 1].context);
  const single = items.length === 1;
  const { subject, text, html } = single
    ? renderTicketEmail(items[0].event, ticket, withBranding(items[0].context), config)
    : renderTicketDigestEmail(ticket, items, context, config);
  const requireBrandLogo = isExternalUser(user);
  const fields = {
    event: single ? items[0].event : row.event,
    template: single ? items[0].event.toLowerCase() : 'ticket_digest',
    to: [user.email],
    from: brandedFrom(config, context.brandName),
    subject,
    threadId: row.threadId || threadIdFor(ticket._id, domainOf(config)),
    listUnsubscribe: optOut.listUnsubscribe,
    renderSnapshot: {
      context, text, html, brandLogoKey: context.brandLogoKey || null, requireBrandLogo,
    },
  };
  // Written before the send: from here on the retry sweep can resend this row.
  await EmailLog.updateOne({ _id: row._id }, { $set: fields });

  let attachments;
  try {
    assertClientBrand(requireBrandLogo, context);
    attachments = await brandAttachments(config, {
      logoKey: context.brandLogoKey,
      requireCompanyMark: requireBrandLogo,
    });
  } catch (err) {
    const error = String(err?.message || err);
    await failRowsForPolicy([row], error, { counted: true });
    logger.error('Ticket email batch blocked by branding policy', {
      emailLogId: String(row._id), ticket: ticket.ticketId, error,
    });
    return 'failed';
  }

  const message = { ...row.toObject(), ...fields, text, html };
  const ok = await attempt(message, deps.transport, config, attachments, null, { counted: true });
  if (ok) {
    await sendTestSinkCopy(deps.transport, config, deps, {
      from: fields.from, subject, text, html, attachments,
    }, { event: fields.event, ticket: ticket.ticketId, emailLogId: String(row._id) });
  }
  return ok ? 'sent' : 'failed';
}

/**
 * One summary email for the claimed rows of one recipient. The first row
 * that still has something to say carries the email: it gets the rendered
 * summary as its snapshot, so a failed send is retried by the ordinary sweep
 * exactly like any other row. The other rows point at it (`mergedInto`) and
 * are closed BEFORE the send — `skipped`, then `sent` once it goes — so a
 * crash or a failure can never send their items a second time, alone.
 * Returns row counts: { sent, skipped, failed }.
 */
async function deliverSummary(rows, config, deps) {
  const counts = { sent: 0, skipped: 0, failed: 0 };
  const user = await User.findById(rows[0].recipientUserId);
  const sections = [];
  for (const row of rows) {
    const prepared = await prepareBatchRow(row, user);
    if (prepared.skip) {
      await skipRow(row, prepared.skip);
      counts.skipped += 1;
    } else {
      sections.push({ row, ...prepared });
    }
  }
  if (sections.length === 0) return counts;

  const [carrier, ...merged] = sections.map((section) => section.row);
  const optOut = withOptOutLinks({}, user._id, config);
  const first = sections[0];
  // One email, one brand: an external reader's tickets all belong to their
  // own client, so the first ticket's brand is theirs. An internal reader's
  // summary can span clients and shows the first one's (or the neutral) mark.
  const context = {
    ...withTicketBranding(first.items[first.items.length - 1].context, first.ticket, config),
    ...optOut.context,
  };
  const { subject, text, html } = renderTicketSummaryEmail(
    sections.map(({ ticket, items }) => ({ ticket, items })),
    context,
    config,
    { frequency: deliveryPrefs(user).emailFrequency },
  );
  const requireBrandLogo = isExternalUser(user);
  const fields = {
    template: 'ticket_summary',
    to: [user.email],
    from: brandedFrom(config, context.brandName),
    subject,
    // A summary spans tickets, so it starts its own thread rather than
    // replying into one ticket's.
    threadId: null,
    listUnsubscribe: optOut.listUnsubscribe,
    renderSnapshot: {
      context, text, html, brandLogoKey: context.brandLogoKey || null, requireBrandLogo,
    },
  };
  await EmailLog.updateOne({ _id: carrier._id }, { $set: fields });
  const mergedIds = merged.map((row) => row._id);
  if (mergedIds.length) {
    await EmailLog.updateMany({ _id: { $in: mergedIds } }, {
      $set: {
        status: 'skipped', skippedAt: new Date(), mergedInto: carrier._id, error: 'Sent in a summary email',
      },
    });
  }

  let attachments;
  try {
    assertClientBrand(requireBrandLogo, context);
    attachments = await brandAttachments(config, {
      logoKey: context.brandLogoKey,
      requireCompanyMark: requireBrandLogo,
    });
  } catch (err) {
    const error = String(err?.message || err);
    await failRowsForPolicy([carrier], error, { counted: true });
    logger.error('Ticket summary email blocked by branding policy', { emailLogId: String(carrier._id), error });
    counts.failed += sections.length;
    return counts;
  }

  const ok = await attempt({ ...carrier.toObject(), ...fields, text, html }, deps.transport, config, attachments, null, {
    counted: true,
  });
  if (!ok) {
    counts.failed += sections.length;
    return counts;
  }
  if (mergedIds.length) {
    await EmailLog.updateMany({ _id: { $in: mergedIds } }, { $set: { status: 'sent', sentAt: new Date() } });
  }
  await sendTestSinkCopy(deps.transport, config, deps, {
    from: fields.from, subject, text, html, attachments,
  }, { event: 'summary', emailLogId: String(carrier._id) });
  counts.sent += sections.length;
  return counts;
}

/**
 * The sweep. Only rows older than the grace period are picked up, long enough
 * that a row mid-flight in a healthy process is never touched. After the cap
 * the row stays `failed` and stops — no unbounded loop hammering a mailbox.
 *
 * Each row is claimed before it is sent (see claimRow), and one row's error is
 * logged and counted rather than ending the batch; that row keeps its claim and
 * becomes eligible again after the grace period.
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
  await EmailLog.updateMany(exhaustedFilter(maxAttempts, cutoff), { $set: { status: 'failed' } });

  const candidates = await EmailLog.find(retryableFilter(maxAttempts, cutoff))
    .sort({ createdAt: 1 }).limit(limit).select('_id').lean();

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  for (const { _id } of candidates) {
    const row = await claimRow(EmailLog, _id, maxAttempts, cutoff)
      .populate({ path: 'recipientUserId', select: 'role roles status notificationPrefs.emailPaused' })
      .populate({
        path: 'ticket',
        populate: {
          path: 'project',
          select: 'brand client',
          populate: { path: 'client', select: 'name logoKey' },
        },
      });
    if (!row) continue; // another sweep claimed it first
    attempted += 1;
    try {
      if (await retryTicketRow(row, transport, config, maxAttempts)) sent += 1; else failed += 1;
    } catch (err) {
      failed += 1;
      logger.error('Ticket email retry errored', { emailLogId: String(row._id), error: err.message });
    }
  }

  return { attempted, sent, failed };
}

async function retryTicketRow(row, transport, config, maxAttempts) {
  // Deactivated or deleted since the event: they no longer get ticket mail.
  if (row.recipientUserId?.status !== 'active') {
    await abandonRow(EmailLog, row._id, maxAttempts, INACTIVE_RECIPIENT);
    return false;
  }
  if (row.recipientUserId.notificationPrefs?.emailPaused === true) {
    await abandonRow(EmailLog, row._id, maxAttempts, EMAIL_PAUSED);
    return false;
  }

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
    await failRowsForPolicy([row], error, { counted: true });
    logger.error('Ticket email retry blocked by branding policy', {
      emailLogId: String(row._id),
      ticket: ticket?.ticketId,
      error,
    });
    return false;
  }
  return attempt({ ...row.toObject(), text, html }, transport, config, attachments, null, { counted: true });
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
    { ...exhaustedFilter(maxAttempts, cutoff), html: { $ne: REDACTED_BODY.html } },
    { $set: { status: 'failed', ...REDACTED_BODY } },
  );

  const candidates = await TransactionalEmailLog.find(retryableFilter(maxAttempts, cutoff))
    .sort({ createdAt: 1 }).limit(limit).select('_id').lean();

  let attempted = 0;
  let sent = 0;
  let failed = 0;

  for (const { _id } of candidates) {
    const row = await claimRow(TransactionalEmailLog, _id, maxAttempts, cutoff);
    if (!row) continue; // another sweep claimed it first
    attempted += 1;
    try {
      // Rows only carry an address. A deactivated or deleted account keeps its
      // email, so that is what is checked; an address with no account is sent.
      const gone = await User.exists({ email: row.to?.[0], status: { $in: ['inactive', 'deleted'] } });
      if (gone) {
        await abandonRow(TransactionalEmailLog, row._id, maxAttempts, INACTIVE_RECIPIENT, REDACTED_BODY);
        failed += 1;
        continue;
      }
      // Per row, not once for the batch: two queued rows can belong to two
      // different clients and must not share one mark.
      const attachments = await brandAttachments(config, { logoKey: row.brandLogoKey });
      const result = await attemptTransactional(row.toObject(), transport, attachments, { counted: true });
      if (result.ok) sent += 1; else failed += 1;
    } catch (err) {
      failed += 1;
      logger.error('Transactional email retry errored', {
        transactionalEmailLogId: String(row._id), error: err.message,
      });
    }
  }

  return { attempted, sent, failed };
}
