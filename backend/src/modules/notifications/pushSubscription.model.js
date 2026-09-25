import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

/**
 * One row per browser install. The endpoint is the device's identity: the same
 * browser re-subscribing (or a different person logging in on it) moves the row
 * to the new user instead of adding a second one.
 */
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true },
);

pushSubscriptionSchema.plugin(toJSON);

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
export default PushSubscription;
