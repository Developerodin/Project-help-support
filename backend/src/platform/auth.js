import { ApiError } from './errors.js';
import User from '../modules/users/user.model.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';

const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');

/**
 * Layer 1. Valid token, user exists, status === 'active'.
 * An invited or inactive user is rejected here regardless of role.
 *
 * The role is re-read from the database rather than trusted from the token
 * payload, so revoking someone's admin rights takes effect on their next
 * request instead of whenever their access token happens to expire.
 */
export function auth(config) {
  return async function authenticate(req, _res, next) {
    try {
      const header = req.headers?.authorization;
      if (!header || !header.startsWith('Bearer ')) return next(unauthenticated());

      const payload = verifyAccessToken(header.slice('Bearer '.length), config);
      const user = await User.findById(payload.sub);

      if (!user || user.status !== 'active') return next(unauthenticated());

      req.user = user;
      if (payload.impersonatedBy) {
        req.impersonation = { by: payload.impersonatedBy };
      }
      return next();
    } catch {
      return next(unauthenticated());
    }
  };
}

/**
 * Layer 2, role-only half. Runs as route middleware, before any database read.
 *
 * Rules that depend on the DOCUMENT — reporter, assignee, comment author,
 * attachment uploader — do NOT belong here. The document does not exist yet at
 * this point, which is exactly how an ownership check ends up not checking
 * ownership. Those live in services, after the load.
 */
export function requireRole(...roles) {
  return function checkRole(req, _res, next) {
    if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
    if (!roles.includes(req.user.role)) {
      // 403, not 404: nothing is hidden in this product, so there is no
      // existence to conceal.
      return next(new ApiError(403, 'FORBIDDEN', `Requires one of: ${roles.join(', ')}`));
    }
    return next();
  };
}
