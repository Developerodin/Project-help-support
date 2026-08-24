import { ROLE_IDS, INTERNAL_ROLES, EXTERNAL_ROLES, ENVIRONMENTS, IMPERSONATION_INITIATOR_ROLES } from './enums.js';
import { getUserRoles, isSuperAdmin, hasAnyRole } from './permissions.js';
import { getRoleBundle, userHasEffectivePermission } from './permission-resolution.js';

/** Roles that may never be granted via scoped assignment APIs. */
export const NON_DELEGATABLE_ROLES = Object.freeze([ROLE_IDS.SUPER_ADMIN]);

/** Roles assignable through scoped assignment endpoints. */
export const SCOPED_ASSIGNABLE_ROLES = Object.freeze(
  [...INTERNAL_ROLES, ...EXTERNAL_ROLES].filter(
    (role) => role !== ROLE_IDS.SUPER_ADMIN && role !== ROLE_IDS.UNASSIGNED,
  ),
);

const ROLE_DELEGATION_RANK = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: 1000,
  [ROLE_IDS.ADMIN]: 900,
  [ROLE_IDS.PROJECT_ADMIN]: 700,
  [ROLE_IDS.DEVELOPER]: 500,
  [ROLE_IDS.TESTER]: 500,
  [ROLE_IDS.SUPPORT]: 400,
  [ROLE_IDS.READ_ONLY]: 200,
  [ROLE_IDS.CLIENT]: 300,
  [ROLE_IDS.CLIENT_TESTER]: 250,
  [ROLE_IDS.UNASSIGNED]: 0,
});

export function maxDelegationRank(user) {
  let max = 0;
  for (const role of getUserRoles(user)) {
    const rank = ROLE_DELEGATION_RANK[role] ?? 0;
    if (rank > max) max = rank;
  }
  return max;
}

export function isDelegatableRole(role) {
  return SCOPED_ASSIGNABLE_ROLES.includes(role);
}

export function canDelegateRole(actor, targetRole) {
  if (!actor || !targetRole) return false;
  if (NON_DELEGATABLE_ROLES.includes(targetRole)) return false;
  if (!isDelegatableRole(targetRole)) return false;
  const actorRank = maxDelegationRank(actor);
  const targetRank = ROLE_DELEGATION_RANK[targetRole] ?? 0;
  return actorRank > targetRank;
}

/**
 * Delegation guardrails for grant/modify/revoke flows.
 * Returns { allowed: true } or { allowed: false, code }.
 */
export function validateDelegation(actor, targetRole, { targetUserId = null } = {}) {
  const actorId = actor?._id ?? actor?.id;
  if (targetUserId && actorId && String(actorId) === String(targetUserId)) {
    return { allowed: false, code: 'CANNOT_DELEGATE_SELF' };
  }
  if (!isDelegatableRole(targetRole)) {
    return { allowed: false, code: 'ROLE_NOT_DELEGATABLE' };
  }
  if (!canDelegateRole(actor, targetRole)) {
    return { allowed: false, code: 'INSUFFICIENT_DELEGATION_RANK' };
  }
  return { allowed: true };
}

/**
 * Impersonation guardrails for initiator/target pairs.
 * Uses the same delegation ranks as scoped assignment — no parallel policy source.
 * Returns { allowed: true } or { allowed: false, code }.
 */
export function validateImpersonation(initiator, target) {
  const initiatorId = initiator?._id ?? initiator?.id;
  const targetId = target?._id ?? target?.id;

  if (initiatorId && targetId && String(initiatorId) === String(targetId)) {
    return { allowed: false, code: 'CANNOT_IMPERSONATE_SELF' };
  }

  if (!hasAnyRole(initiator, ...IMPERSONATION_INITIATOR_ROLES)) {
    return { allowed: false, code: 'NOT_IMPERSONATION_INITIATOR' };
  }

  if (!target) {
    return { allowed: false, code: 'USER_NOT_FOUND' };
  }

  if (isSuperAdmin(target)) {
    return { allowed: false, code: 'SUPER_ADMIN_PROTECTED' };
  }

  // ponytail: admin peers blocked by role membership; everyone else by rank.
  if (!isSuperAdmin(initiator) && hasAnyRole(target, ROLE_IDS.ADMIN)) {
    return { allowed: false, code: 'CANNOT_IMPERSONATE_PEER' };
  }

  const initiatorRank = maxDelegationRank(initiator);
  const targetRank = maxDelegationRank(target);
  if (initiatorRank <= targetRank) {
    return { allowed: false, code: 'INSUFFICIENT_IMPERSONATION_RANK' };
  }

  return { allowed: true };
}

export function canImpersonateUser(initiator, target) {
  return validateImpersonation(initiator, target).allowed;
}

export function normaliseScopeTarget({ clientId = null, projectId = null, environment = null } = {}) {
  const hasEnvironment = environment != null && environment !== '';
  const environmentValid = !hasEnvironment || ENVIRONMENTS.includes(environment);
  return {
    clientId: clientId ?? null,
    projectId: projectId ?? null,
    environment: environmentValid && hasEnvironment ? environment : null,
    invalidEnvironment: hasEnvironment && !environmentValid,
  };
}

/** Normalise assignment scope fields from DB (`client`/`project`) or API (`clientId`/`projectId`). */
export function normaliseAssignmentScope(assignment) {
  if (!assignment) return { client: null, project: null };
  return {
    client: assignment.client ?? assignment.clientId ?? null,
    project: assignment.project ?? assignment.projectId ?? null,
  };
}

export function isAssignmentExpired(assignment, now = new Date()) {
  if (!assignment?.expiresAt) return false;
  const expires = new Date(assignment.expiresAt);
  return !Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime();
}

export function isAssignmentEffectivelyActive(assignment, now = new Date()) {
  return assignment?.status === 'active' && !isAssignmentExpired(assignment, now);
}

export function isGlobalAssignment(assignment) {
  const { client, project } = normaliseAssignmentScope(assignment);
  return !client && !project;
}

/**
 * Empty assignment environments mean the row exists but grants no environment/ticket axis.
 * When a target environment is omitted, any non-empty environment list is sufficient.
 */
export function environmentGrantsAccess(assignmentEnvironments = [], targetEnvironment = null) {
  const envs = assignmentEnvironments || [];
  if (!envs.length) return targetEnvironment == null;
  if (!targetEnvironment) return true;
  return envs.includes(targetEnvironment);
}

export function assignmentCoversScope(assignment, target) {
  if (!isAssignmentEffectivelyActive(assignment)) return false;

  const scope = normaliseScopeTarget(target);
  if (scope.invalidEnvironment) return false;

  const { client, project } = normaliseAssignmentScope(assignment);

  if (isGlobalAssignment(assignment)) {
    return environmentGrantsAccess(assignment.environments, scope.environment);
  }

  if (client && scope.clientId && String(client) !== String(scope.clientId)) {
    return false;
  }

  // ponytail: client-wide grants need clientId in scope when projectId is present.
  if (!project && client && scope.projectId && !scope.clientId) {
    return false;
  }

  if (project) {
    if (!scope.projectId || String(project) !== String(scope.projectId)) {
      return false;
    }
  }

  return environmentGrantsAccess(assignment.environments, scope.environment);
}

export function assignmentRoleHasPermission(assignment, permission, roleMatrix = null) {
  return getRoleBundle(assignment.role, roleMatrix).has(permission);
}

export function hasActiveScopedConstraints(assignments = []) {
  return (assignments || []).some((row) => isAssignmentEffectivelyActive(row));
}

/**
 * Global effective permission plus optional scoped constraints.
 * Super Admin bypasses scoped constraints. Users without active assignments keep
 * global-only behaviour for backward compatibility.
 */
export function canInScope(
  user,
  permission,
  scopeTarget,
  { roleMatrix = null, userOverrides = {}, scopedAssignments = [], loadFailed = false } = {},
) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  if (loadFailed) return false;

  if (!userHasEffectivePermission(user, permission, { roleMatrix, userOverrides })) {
    return false;
  }

  const scopedRows = (scopedAssignments || []).filter((row) => row.status === 'active');
  if (!scopedRows.length) return true;

  const active = scopedRows.filter((row) => !isAssignmentExpired(row));
  if (!active.length) return false;

  const scope = normaliseScopeTarget(scopeTarget || {});
  if (scope.invalidEnvironment) return false;

  const needsScope = Boolean(scope.clientId || scope.projectId || scope.environment);
  if (!needsScope) return true;

  return active.some(
    (assignment) => assignmentCoversScope(assignment, scope)
      && assignmentRoleHasPermission(assignment, permission, roleMatrix),
  );
}
