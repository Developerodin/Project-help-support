import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

const objectId = mongoose.Schema.Types.ObjectId;

const rbacAuditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    category: { type: String, enum: ['policy', 'access', 'security', 'whatsapp'], required: true, index: true },
    // Null only for WhatsApp events from a number with no account behind it (code guessing, strangers).
    actor: {
      type: objectId, ref: 'User', default: null, index: true, required() { return this.category !== 'whatsapp'; },
    },
    initiator: { type: objectId, ref: 'User', default: null, index: true },
    targetUser: { type: objectId, ref: 'User', default: null, index: true },
    assignment: { type: objectId, ref: 'AccessAssignment', default: null },
  // ponytail: append-only blob — no query layer, just replay what changed.
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

rbacAuditLogSchema.index({ createdAt: -1 });

rbacAuditLogSchema.plugin(toJSON);

const RbacAuditLog = mongoose.model('RbacAuditLog', rbacAuditLogSchema);
export default RbacAuditLog;
