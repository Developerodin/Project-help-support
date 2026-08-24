import { can, hasActiveScopedConstraints, isExternalUser } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import {
  assertPermissionInScope,
  loadPermissionContextForUser,
} from '../rbac/rbac.service.js';

export function ticketScopeTarget(ticket, projectDoc = null) {
  const projectId = ticket.project?._id ?? ticket.project ?? null;
  let clientId = ticket.project?.client ?? null;
  if (!clientId && projectDoc) {
    clientId = projectDoc.client?._id ?? projectDoc.client ?? null;
  }
  return {
    clientId,
    projectId,
    environment: ticket.environment ?? null,
  };
}

export function projectScopeTarget(project) {
  return {
    clientId: project.client?._id ?? project.client ?? null,
    projectId: project._id ?? project.id ?? null,
  };
}

export function clientScopeTarget(clientId) {
  return { clientId, projectId: null };
}

export async function resolvePermissionContext(actor, permissionContext) {
  if (permissionContext) return permissionContext;
  return loadPermissionContextForUser(actor._id);
}

export async function assertScopedPermission(
  actor,
  permission,
  scopeTarget,
  permissionContext = null,
) {
  const ctx = await resolvePermissionContext(actor, permissionContext);
  assertPermissionInScope(actor, permission, scopeTarget, ctx);
}

export async function assertScopedPermissionWhenConstrained(
  actor,
  permission,
  scopeTarget,
  permissionContext = null,
) {
  const ctx = await resolvePermissionContext(actor, permissionContext);
  if (!hasActiveScopedConstraints(ctx.scopedAssignments)) return;
  assertPermissionInScope(actor, permission, scopeTarget, ctx);
}

/** Project reads require both company and project view permissions (internal users only). */
export async function assertCanViewProjects(actor, permissionContext = null) {
  if (!actor || isExternalUser(actor)) return;
  const ctx = await resolvePermissionContext(actor, permissionContext);
  if (!can(actor, 'clients.view', ctx)) {
    throw new ApiError(403, 'FORBIDDEN', 'Requires permission: clients.view');
  }
  if (!can(actor, 'projects.view', ctx)) {
    throw new ApiError(403, 'FORBIDDEN', 'Requires permission: projects.view');
  }
}

/** Team reads require teams.view (internal users only). */
export async function assertCanViewTeams(actor, permissionContext = null) {
  if (!actor || isExternalUser(actor)) return;
  const ctx = await resolvePermissionContext(actor, permissionContext);
  if (!can(actor, 'teams.view', ctx)) {
    throw new ApiError(403, 'FORBIDDEN', 'Requires permission: teams.view');
  }
}
