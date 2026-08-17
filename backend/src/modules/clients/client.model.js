import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    /** S3 object key for the company logo. Never store the raw upload path. */
    logoKey: { type: String, trim: true, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

clientSchema.index(
  { name: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'client_name_active_unique',
  },
);

clientSchema.plugin(toJSON);

const Client = mongoose.model('Client', clientSchema);
export default Client;
