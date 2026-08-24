import mongoose from 'mongoose';
import { ROLES, ENVIRONMENTS } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const objectId = mongoose.Schema.Types.ObjectId;

const accessAssignmentSchema = new mongoose.Schema(
  {
    user: { type: objectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    client: { type: objectId, ref: 'Client', default: null, index: true },
    project: {
      type: objectId,
      ref: 'Project',
      default: null,
      index: true,
      validate: {
        validator() { return this.project == null || this.client != null; },
        message: 'A project-scoped assignment must also have a client',
      },
    },
    environments: {
      type: [{ type: String, enum: ENVIRONMENTS }],
      default: [],
      set: (values) => [...new Set(values)],
    },
    status: { type: String, enum: ['active', 'suspended', 'revoked'], default: 'active', index: true },
    expiresAt: {
      type: Date,
      default: null,
      validate: {
        validator(v) {
          if (v == null) return true;
          // Lifecycle updates on already-expired rows must not be blocked.
          // findOneAndUpdate validators receive a plain update object without isModified.
          if (typeof this.isModified === 'function' && !this.isNew && !this.isModified('expiresAt')) {
            return true;
          }
          return v > new Date();
        },
        message: 'expiresAt must be in the future',
      },
    },
    grantedBy: { type: objectId, ref: 'User', required: true },
    reason: {
      type: String,
      trim: true,
      validate: {
        validator(v) {
          const sensitive = this.status !== 'active' || this.environments.includes('Production');
          return !sensitive || Boolean(v && v.trim());
        },
        message: 'A reason is required when revoking, suspending, or granting Production access',
      },
    },
  },
  { timestamps: true },
);

accessAssignmentSchema.index({ user: 1, status: 1 });
accessAssignmentSchema.index({ client: 1, project: 1, status: 1 });
accessAssignmentSchema.index({ expiresAt: 1 }, { sparse: true });
accessAssignmentSchema.index(
  { user: 1, role: 1, client: 1, project: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'access_assignment_active_scope_unique',
  },
);

accessAssignmentSchema.pre('validate', function validateReason(next) {
  const sensitive = this.status !== 'active' || (this.environments || []).includes('Production');
  if (sensitive && !this.reason?.trim()) {
    this.invalidate(
      'reason',
      'A reason is required when revoking, suspending, or granting Production access',
    );
  }
  next();
});

accessAssignmentSchema.plugin(toJSON);

const AccessAssignment = mongoose.model('AccessAssignment', accessAssignmentSchema);
export default AccessAssignment;
