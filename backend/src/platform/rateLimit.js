import rateLimit from 'express-rate-limit';
import { ApiError } from './errors.js';
import RateLimitHit from './rateLimitHit.model.js';

/**
 * express-rate-limit store backed by Mongo, so every backend instance counts
 * against the same window (the in-memory default multiplies limits by the
 * instance count). One atomic update per hit: a new window starts when the old
 * one has passed. `prefix` keeps limiters that share a key apart.
 */
export class MongoRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const now = new Date();
    const live = { $gt: ['$resetAt', now] };
    const doc = await RateLimitHit.findOneAndUpdate(
      { _id: `${this.prefix}:${key}` },
      [{
        $set: {
          hits: { $cond: [live, { $add: ['$hits', 1] }, 1] },
          resetAt: { $cond: [live, '$resetAt', new Date(now.getTime() + this.windowMs)] },
        },
      }],
      { upsert: true, new: true, lean: true },
    );
    return { totalHits: doc.hits, resetTime: doc.resetAt };
  }

  async decrement(key) {
    await RateLimitHit.updateOne({ _id: `${this.prefix}:${key}`, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key) {
    await RateLimitHit.deleteOne({ _id: `${this.prefix}:${key}` });
  }
}

/**
 * ponytail: the default in-memory store unless a limiter passes `store`.
 *
 * The ceiling: the memory store is per-process, so an N-instance deployment
 * multiplies the effective limit by N. The assistant's limiters already use
 * MongoRateLimitStore; the auth limiters can switch the same way (pass
 * `store: new MongoRateLimitStore('login')`) once a second instance exists.
 */
export function makeLimiter({
  windowMs, limit, byEmail = false, byUser = false, store,
}) {
  return rateLimit({
    windowMs,
    limit,
    ...(store ? { store } : {}),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Custom keyGenerator already falls back to IP; disable validate keys that
    // vary across express-rate-limit minor versions.
    validate: false,
    keyGenerator: (req) => {
      const ip = req.ip || 'unknown-ip';
      // Per-account bucket for authenticated routes (mount after auth()).
      if (byUser) return req.user?._id ? `user:${req.user._id}` : ip;
      if (!byEmail) return ip;
      // Email is the shared bucket so one account cannot be sprayed from many
      // IPs. Empty email falls back to IP so unauthenticated junk still counts.
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      return email || ip;
    },
    handler: (_req, _res, next) => next(
      new ApiError(429, 'RATE_LIMITED', 'Too many requests, please try again later'),
    ),
  });
}

const MINUTE = 60 * 1000;

export const loginLimiter = makeLimiter({ windowMs: 15 * MINUTE, limit: 10, byEmail: true });
export const passwordResetLimiter = makeLimiter({ windowMs: 60 * MINUTE, limit: 5, byEmail: true });
export const inviteAcceptLimiter = makeLimiter({ windowMs: 60 * MINUTE, limit: 10 });
export const refreshLimiter = makeLimiter({ windowMs: 15 * MINUTE, limit: 60 });
export const resendInviteLimiter = makeLimiter({ windowMs: 60 * MINUTE, limit: 10 });