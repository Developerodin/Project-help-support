import { ROLE_IDS, hasAnyRole, isExternalUser } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';

/** Matches frontend route-permissions.js analytics gate. */
export const ANALYTICS_ROLES = Object.freeze([
  ROLE_IDS.SUPER_ADMIN,
  ROLE_IDS.ADMIN,
  ROLE_IDS.PROJECT_ADMIN,
  ROLE_IDS.TESTER,
]);

export function requireAnalyticsAccess(req, _res, next) {
  if (!req.user) {
    return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
  }
  if (isExternalUser(req.user)) {
    return next(new ApiError(403, 'FORBIDDEN', 'Analytics is not available for external users'));
  }
  if (!hasAnyRole(req.user, ...ANALYTICS_ROLES)) {
    return next(new ApiError(403, 'FORBIDDEN', `Requires one of: ${ANALYTICS_ROLES.join(', ')}`));
  }
  return next();
}
