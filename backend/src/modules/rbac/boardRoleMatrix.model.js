import mongoose from 'mongoose';
import { BOARD_CAPABILITIES, BOARD_KEYS, MATRIX_ROLES } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const boardRoleMatrixSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'active', unique: true, immutable: true },
    grants: {
      type: Map,
      of: {
        type: Map,
        of: [{ type: String, enum: BOARD_CAPABILITIES }],
      },
      required: true,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

boardRoleMatrixSchema.pre('validate', function validateGrants(next) {
  for (const role of this.grants?.keys?.() || []) {
    if (!MATRIX_ROLES.includes(role)) {
      this.invalidate('grants', `Unknown matrix role: ${role}`);
    }
    const boards = this.grants.get(role);
    for (const board of boards?.keys?.() || []) {
      if (!BOARD_KEYS.includes(board)) {
        this.invalidate('grants', `Unknown board: ${board}`);
      }
    }
  }
  next();
});

boardRoleMatrixSchema.plugin(toJSON);

const BoardRoleMatrix = mongoose.model('BoardRoleMatrix', boardRoleMatrixSchema);
export default BoardRoleMatrix;
