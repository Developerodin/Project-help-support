import { ApiError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const blocked = (message = 'Cross-origin request blocked') => new ApiError(
  403, 'CROSS_ORIGIN_BLOCKED', message,
);

/**
 * CSRF defence for cookie-authenticated state-changing routes.
 *
 * SameSite=Strict on the refresh cookie carries most of the load; this is the
 * belt for the browsers and edge cases where it does not. A request with no
 * Origin and no Referer is allowed: that is curl or a server-to-server call,
 * neither of which carries ambient cookies from a victim's browser.
 */
export function sameOrigin(config) {
  const allowed = new Set(config.corsOrigins);

  return function check(req, _res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.headers?.origin;
    if (origin) {
      return allowed.has(origin) ? next() : next(blocked());
    }

    const referer = req.headers?.referer;
    if (referer) {
      try {
        const { origin: refOrigin } = new URL(referer);
        return allowed.has(refOrigin) ? next() : next(blocked());
      } catch {
        return next(blocked('Malformed Referer header'));
      }
    }

    return next();
  };
}
