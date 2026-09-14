import mongoose from 'mongoose';
import {
  can,
  hasActiveScopedConstraints,
  isExternalUser,
  isAssignmentEffectivelyActive,
  assignmentRoleHasPermission,
  normaliseAssignmentScope,
  isGlobalAssignment,
} from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import Project from '../projects/project.model.js';
import {
  assertPermissionInScope,
  loadPermissionContextForUser,
} from '../rbac/rbac.service.js';

const EMPTY_TICKET_FILTER = Object.freeze({ _id: { $in: [] } });

function toObjectId(value) {
  if (value == null) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return value;
}

function environmentClause(environments, base) {
  const envs = environments || [];
  if (!envs.length) return base;
  return { $and: [base, { environment: { $in: envs } }] };
}

/**
 * Mongo filter for ticket list/board when the actor has active scoped assignments.
 * Aligns list visibility with assertTicketInActorScope (scope wins over team expansion).
 */
export async function buildScopedTicketListFilter(permissionContext, permission = 'tickets.view') {
  const assignments = permissionContext?.scopedAssignments || [];
  const orClauses = [];
  const clientOnlyIds = new Set();
  let unrestrictedGlobal = false;

  for (const row of assignments) {
    if (!isAssignmentEffectivelyActive(row)) continue;
    if (!assignmentRoleHasPermission(row, permission, permissionContext.roleMatrix)) continue;

    const { client, project } = normaliseAssignmentScope(row);
    if (project) {
      orClauses.push(environmentClause(row.environments, { project: toObjectId(project) }));
      continue;
    }
    if (client) {
      clientOnlyIds.add(String(client));
      continue;
    }
    if (isGlobalAssignment(row)) {
      const envs = row.environments || [];
      if (!envs.length) unrestrictedGlobal = true;
      else orClauses.push({ environment: { $in: envs } });
    }
  }

  if (unrestrictedGlobal) return null;

  if (clientOnlyIds.size) {
    const projects = await Project.find({
      client: { $in: [...clientOnlyIds].map(toObjectId) },
      status: 'active',
    }).select('_id client').lean();

    for (const row of assignments) {
      if (!isAssignmentEffectivelyActive(row)) continue;
      if (!assignmentRoleHasPermission(row, permission, permissionContext.roleMatrix)) continue;
      const { client, project } = normaliseAssignmentScope(row);
      if (project || !client) continue;
      const clientKey = String(client);
      if (!clientOnlyIds.has(clientKey)) continue;
      for (const proj of projects) {
        if (String(proj.client) !== clientKey) continue;
        orClauses.push(environmentClause(
          row.environments,
          { project: proj._id },
        ));
      }
    }
  }

  if (!orClauses.length) return EMPTY_TICKET_FILTER;
  return { $or: orClauses };
}

export function ticketScopeTarget(ticket, projectDoc = null) {
  const projectId = ticket.project?._id ?? ticket.project ?? null;
  let clientId = ticket.project?.client?._id ?? ticket.project?.client ?? null;
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
