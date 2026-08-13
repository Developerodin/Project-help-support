import rateLimit from 'express-rate-limit';
import { ApiError } from './errors.js';

/**
 * ponytail: the default in-memory store, NOT Redis.
 *
 * The ceiling: the store is per-process, so an N-instance deployment multiplies
 * the effective limit by N. Accepted at this scale. The upgrade path is a shared
 * store, and it becomes worth doing when a second instance actually exists.
 */
export function makeLimiter({ windowMs, limit, byEmail = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Custom keyGenerator already falls back to IP; disable validate keys that
    // vary across express-rate-limit minor versions.
    validate: false,
    keyGenerator: (req) => {
      const ip = req.ip || 'unknown-ip';
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