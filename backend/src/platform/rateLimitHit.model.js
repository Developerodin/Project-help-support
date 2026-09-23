import mongoose from 'mongoose';

/**
 * One rate-limit window per key, shared by every backend instance. Mongo's TTL
 * monitor removes expired windows (it runs about once a minute, so a stale
 * window can outlive resetAt briefly; the store treats it as expired anyway).
 */
const rateLimitHitSchema = new mongoose.Schema(
  {
    _id: { type: String },
    hits: { type: Number, required: true },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false },
);

rateLimitHitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.RateLimitHit || mongoose.model('RateLimitHit', rateLimitHitSchema);
