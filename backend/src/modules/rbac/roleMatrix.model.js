import mongoose from 'mongoose';
import { MATRIX_ROLES, PERMISSIONS } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const roleMatrixSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'active', unique: true, immutable: true },
    grants: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      required: true,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

function isStoredGrantValue(value) {
  if (Array.isArray(value)) {
    return value.every((permission) => typeof permission === 'string' && PERMISSIONS.includes(permission));
  }
  if (value && typeof value === 'object') {
    const extra = Object.keys(value).filter((key) => key !== 'add' && key !== 'remove');
    if (extra.length > 0) return false;
    if (value.add !== undefined && !Array.isArray(value.add)) return false;
    if (value.remove !== undefined && !Array.isArray(value.remove)) return false;
    if (value.add === undefined && value.remove === undefined) return false;
    const permissions = [...(value.add || []), ...(value.remove || [])];
    return permissions.every((permission) => typeof permission === 'string' && PERMISSIONS.includes(permission));
  }
  return false;
}

roleMatrixSchema.pre('validate', function validateGrants(next) {
  for (const role of this.grants?.keys?.() || []) {
    if (!MATRIX_ROLES.includes(role)) {
      this.invalidate('grants', `Unknown matrix role: ${role}`);
      continue;
    }
    const value = this.grants.get(role);
    if (!isStoredGrantValue(value)) {
      this.invalidate('grants', `Invalid customization for role: ${role}`);
    }
  }
  next();
});

roleMatrixSchema.plugin(toJSON);

const RoleMatrix = mongoose.model('RoleMatrix', roleMatrixSchema);
export default RoleMatrix;
