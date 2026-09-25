import mongoose from 'mongoose';
import { NOTIFICATION_EVENTS } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const emailLogSchema = new mongoose.Schema(
  {
    /** One id per fan-out: groups every row produced by a single domain event. */
    eventId: { type: String, required: true, index: true },
    event: { type: String, enum: NOTIFICATION_EVENTS, required: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', index: true },
    /** ONE ROW PER RECIPIENT — a partial failure must record who actually received it. */
    recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    /** Which sending identity produced this. No mailbox registry exists; `from` distinguishes them. */
    from: { type: String },
    subject: { type: String },
    template: { type: String },
    /**
     * `queued`: a batch still collecting events (see `batch`). `skipped`: a
     * batch that had nothing left to say at send time. Both, like `sent`, are
     * never touched by the retry sweep.
     */
    status: {
      type: String,
      enum: ['queued', 'pending', 'sending', 'sent', 'failed', 'skipped'],
      default: 'pending',
      index: true,
    },
    attemptCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    /** Deterministic: <eventId>.<recipientUserId>@<domain>. Stable across retries. */
    messageId: { type: String },
    /** <ticket.<ticketObjectId>@<domain>>: In-Reply-To and References, so a ticket's mail threads. */
    threadId: { type: String },
    error: { type: String },
    sentAt: { type: Date },
    requestId: { type: String },
    /**
     * Immutable render payload captured at enqueue time for retry stability.
     * Legacy rows may not have this and are re-rendered from ticket state.
     */
    /**
     * Batched ticket mail: the events one recipient has not been emailed about
     * yet on this ticket. `context` is exactly what that event's single email
     * would have rendered, already cut for this recipient's audience.
     */
    batch: {
      type: [{
        _id: false,
        event: { type: String, enum: NOTIFICATION_EVENTS, required: true },
        context: { type: mongoose.Schema.Types.Mixed },
        // The in-app row this event landed on; read in-app means not emailed.
        notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification' },
        // Mentions and "assigned to you" are sent straight away, read or not.
        urgent: { type: Boolean },
        at: { type: Date },
      }],
      default: undefined,
    },
    /** A queued batch goes out at this time; each new event pushes it back, up to batchDeadline. */
    sendAfter: { type: Date },
    batchDeadline: { type: Date },
    skippedAt: { type: Date },
    renderSnapshot: {
      context: { type: mongoose.Schema.Types.Mixed },
      text: { type: String },
      html: { type: String },
      brandLogoKey: { type: String },
      requireBrandLogo: { type: Boolean },
    },
  },
  { timestamps: true },
);

emailLogSchema.index({ status: 1, lastAttemptAt: 1 });
// Delivered mail is kept 90 days for support questions, then dropped. Only
// `sent` rows expire: a pending or failed row is the outbox and the evidence.
emailLogSchema.index(
  { sentAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60, partialFilterExpression: { status: 'sent' } },
);

// A skipped batch answers "why didn't I get an email?" as long as a sent one does.
emailLogSchema.index(
  { skippedAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60, partialFilterExpression: { status: 'skipped' } },
);
// At most one open batch per (recipient, ticket): two events landing at once
// append to the same row instead of each starting their own email.
emailLogSchema.index(
  { recipientUserId: 1, ticket: 1 },
  { unique: true, partialFilterExpression: { status: 'queued' } },
);

emailLogSchema.plugin(toJSON);

const EmailLog = mongoose.model('EmailLog', emailLogSchema);
export default EmailLog;
