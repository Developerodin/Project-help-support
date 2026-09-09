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
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    attemptCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    /** Deterministic: <eventId>.<recipientUserId>@<domain>. Stable across retries. */
    messageId: { type: String },
    error: { type: String },
    sentAt: { type: Date },
    requestId: { type: String },
    /**
     * Immutable render payload captured at enqueue time for retry stability.
     * Legacy rows may not have this and are re-rendered from ticket state.
     */
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

emailLogSchema.plugin(toJSON);

const EmailLog = mongoose.model('EmailLog', emailLogSchema);
export default EmailLog;
