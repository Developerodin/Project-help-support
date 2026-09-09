import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

const transactionalEmailLogSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['invite', 'password_reset'],
      required: true,
      index: true,
    },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    from: { type: String, default: '' },
    subject: { type: String, required: true },
    text: { type: String, required: true },
    html: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    attemptCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    sentAt: { type: Date },
    error: { type: String },
    requestId: { type: String },
  },
  { timestamps: true },
);

transactionalEmailLogSchema.index({ status: 1, lastAttemptAt: 1 });

transactionalEmailLogSchema.plugin(toJSON);

const TransactionalEmailLog = mongoose.model('TransactionalEmailLog', transactionalEmailLogSchema);
export default TransactionalEmailLog;
