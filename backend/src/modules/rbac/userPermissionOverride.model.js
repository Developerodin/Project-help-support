import mongoose from 'mongoose';
import { OVERRIDE_EDITABLE_PERMISSIONS, PERMISSION_OVERRIDE_STATES } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const overrideEntrySchema = new mongoose.Schema(
  {
    permission: { type: String, enum: OVERRIDE_EDITABLE_PERMISSIONS, required: true },
    state: { type: String, enum: PERMISSION_OVERRIDE_STATES, required: true },
  },
  { _id: false },
);

const userPermissionOverrideSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    entries: { type: [overrideEntrySchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

userPermissionOverrideSchema.plugin(toJSON);

const UserPermissionOverride = mongoose.model('UserPermissionOverride', userPermissionOverrideSchema);
export default UserPermissionOverride;
