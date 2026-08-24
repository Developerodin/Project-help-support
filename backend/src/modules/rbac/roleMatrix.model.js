import mongoose from 'mongoose';
import { MATRIX_ROLES, PERMISSIONS } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const roleMatrixSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'active', unique: true, immutable: true },
    grants: {
      type: Map,
      of: [{ type: String, enum: PERMISSIONS }],
      required: true,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

roleMatrixSchema.pre('validate', function validateGrants(next) {
  for (const role of this.grants?.keys?.() || []) {
    if (!MATRIX_ROLES.includes(role)) {
      this.invalidate('grants', `Unknown matrix role: ${role}`);
    }
  }
  next();
});

roleMatrixSchema.plugin(toJSON);

const RoleMatrix = mongoose.model('RoleMatrix', roleMatrixSchema);
export default RoleMatrix;
