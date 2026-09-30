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
 * Mongo in production, so every instance shares one count and a restart can't
 * reset it. Elsewhere, memory: a local backend pointed at a shared database must
 * not write counters into it, and a restart clearing them is what you want there.
 */
function sharedStore(prefix) {
  return process.env.NODE_ENV === 'production' ? new MongoRateLimitStore(prefix) : undefined;
}

/**
 * ponytail: the default in-memory store unless a limiter passes `store`.
 *
 * The ceiling: the memory store is per-process, so an N-instance deployment
 * multiplies the effective limit by N. The auth and assistant limiters use
 * MongoRateLimitStore; the rest can switch the same way once it matters.
 */
export function makeLimiter({
  windowMs, limit, byEmail = false, byUser = false, store, skipSuccessfulRequests = false,
}) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
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

// Auth limiters count in Mongo so a restart or a second instance doesn't reset them.
export const loginLimiter = makeLimiter({
  windowMs: 15 * MINUTE, limit: 10, byEmail: true, store: sharedStore('login'),
});
// The per-email bucket alone lets one IP try a password across many accounts.
export const loginIpLimiter = makeLimiter({
  windowMs: 15 * MINUTE, limit: 50, store: sharedStore('login-ip'),
});
export const passwordResetLimiter = makeLimiter({
  windowMs: 60 * MINUTE, limit: 5, byEmail: true, store: sharedStore('password-reset'),
});
export const inviteAcceptLimiter = makeLimiter({
  windowMs: 60 * MINUTE, limit: 10, store: sharedStore('invite-accept'),
});
// Only failed refreshes count: a working session refreshes on every reload and
// tab, and a whole office can share one IP. Guessing a 256-bit token is what
// this brakes, and every guess fails.
export const refreshLimiter = makeLimiter({
  windowMs: 15 * MINUTE, limit: 60, store: sharedStore('refresh'),
  skipSuccessfulRequests: true,
});
export const resendInviteLimiter = makeLimiter({ windowMs: 60 * MINUTE, limit: 10 });
// Unsubscribe links carry no session, so this is the only brake on token guessing.
export const unsubscribeLimiter = makeLimiter({ windowMs: 15 * MINUTE, limit: 30 });
