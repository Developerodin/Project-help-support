import { can } from '@pms/shared';
import { ApiError } from './errors.js';
import User from '../modules/users/user.model.js';

/**
 * Effective permission for the request actor, or — during impersonation — the initiator
 * when the session subject lacks the grant but the admin who started impersonation has it.
 */
export async function hasEffectivePermission(actor, permission, permissionContext, impersonation) {
  if (!actor) return false;
  if (!permissionContext?.loadFailed && can(actor, permission, permissionContext ?? undefined)) {
    return true;
  }
  if (!impersonation?.by) return false;

  const initiator = await User.findById(impersonation.by);
  if (!initiator || initiator.status !== 'active') return false;

  const { loadPermissionContextForUser } = await import('../modules/rbac/rbac.service.js');
  const initiatorCtx = await loadPermissionContextForUser(initiator._id);
  if (initiatorCtx.loadFailed) return false;
  return can(initiator, permission, initiatorCtx);
}

export async function assertEffectivePermission(
  actor,
  permission,
  permissionContext,
  impersonation,
) {
  if (await hasEffectivePermission(actor, permission, permissionContext, impersonation)) return;
  throw new ApiError(403, 'FORBIDDEN', `Requires permission: ${permission}`);
}
