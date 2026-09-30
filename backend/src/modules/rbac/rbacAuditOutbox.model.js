import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

const objectId = mongoose.Schema.Types.ObjectId;

const rbacAuditOutboxSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    actor: {
      type: objectId, ref: 'User', default: null, index: true, required() { return !this.action?.startsWith('whatsapp.'); },
    },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    // pending -> processing (claimed by one replayer) -> deleted on success,
    // back to pending on failure, or failed once attempts reach the cap.
    status: { type: String, enum: ['pending', 'processing', 'failed'], default: 'pending', index: true },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

rbacAuditOutboxSchema.index({ status: 1, createdAt: 1 });

rbacAuditOutboxSchema.plugin(toJSON);

const RbacAuditOutbox = mongoose.model('RbacAuditOutbox', rbacAuditOutboxSchema);
export default RbacAuditOutbox;
