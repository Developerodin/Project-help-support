import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

const objectId = mongoose.Schema.Types.ObjectId;

const rbacAuditOutboxSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    actor: { type: objectId, ref: 'User', required: true, index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    status: { type: String, enum: ['pending', 'failed'], default: 'pending', index: true },
  },
  { timestamps: true },
);

rbacAuditOutboxSchema.index({ status: 1, createdAt: 1 });

rbacAuditOutboxSchema.plugin(toJSON);

const RbacAuditOutbox = mongoose.model('RbacAuditOutbox', rbacAuditOutboxSchema);
export default RbacAuditOutbox;
