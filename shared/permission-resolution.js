import { PERMISSIONS, ROLE_PERMISSIONS, migratePermissionKeys, resolvePermissionKey } from './role-permission-bundles.js';
import {
  ROLE_IDS,
  INTERNAL_ROLES,
  EXTERNAL_ROLES,
} from './enums.js';

function getUserRoles(user) {
  if (!user) return [];
  const roles = user.roles;
  if (Array.isArray(roles) && roles.length > 0) return [...new Set(roles)];
  if (user.role) return [user.role];
  return [];
}

/** Permission groups for matrix UI — mirrors frontend preview layout. */
export const PERMISSION_GROUPS = Object.freeze([
  { label: 'Clients', permissions: ['clients.view', 'clients.manage'] },
  { label: 'Projects', permissions: ['projects.view', 'projects.manage'] },
  { label: 'Teams', permissions: ['teams.view', 'teams.create', 'teams.edit', 'teams.delete'] },
  {
    label: 'Tickets',
    permissions: [
      'tickets.view', 'tickets.create', 'tickets.edit', 'tickets.delete',
      'tickets.manage_assignment', 'tickets.manage_stage',
      'tickets.manage_comments', 'tickets.manage_attachments',
      'tickets.accept',
    ],
  },
  { label: 'People', permissions: ['users.view', 'users.manage'] },
  { label: 'Access control', permissions: ['access.view', 'access.grant', 'access.revoke'] },
  { label: 'Audit', permissions: ['audit.view'] },
]);

/** Roles shown in the global role matrix (excludes invite-default unassigned). */
export const MATRIX_ROLES = Object.freeze([
  ...INTERNAL_ROLES.filter((role) => role !== ROLE_IDS.UNASSIGNED),
  ...EXTERNAL_ROLES,
]);

/** Per-user override states. Absent keys inherit from the role baseline. */
export const PERMISSION_OVERRIDE_STATES = Object.freeze(['allow', 'deny']);

/** Subset of permissions editable via the People override editor. */
export const OVERRIDE_EDITABLE_PERMISSIONS = Object.freeze([
  'tickets.create',
  'tickets.edit',
  'tickets.delete',
  'tickets.manage_assignment',
  'users.manage',
  'access.grant',
]);

function assertKnownPermission(permission) {
  if (!PERMISSIONS.includes(permission)) {
    throw new Error(`Unknown permission: ${permission}`);
  }
}

function assertKnownRole(role) {
  if (!MATRIX_ROLES.includes(role)) {
    throw new Error(`Unknown matrix role: ${role}`);
  }
}

function assertOverrideState(state) {
  if (!PERMISSION_OVERRIDE_STATES.includes(state)) {
    throw new Error(`Invalid override state: ${state}`);
  }
}

/** Build a role→Set map from a ROLE_PERMISSIONS-shaped source. */
export function buildRoleMatrix(source = ROLE_PERMISSIONS) {
  const matrix = {};
  for (const role of MATRIX_ROLES) {
    matrix[role] = new Set(source[role] || []);
  }
  return matrix;
}

export function cloneRoleMatrix(matrix) {
  const clone = {};
  for (const role of MATRIX_ROLES) {
    clone[role] = new Set(matrix[role] || []);
  }
  return clone;
}

export function roleMatrixToRecord(matrix) {
  const record = {};
  for (const role of MATRIX_ROLES) {
    record[role] = [...(matrix[role] || [])].sort();
  }
  return record;
}

export function recordToRoleMatrix(record) {
  const matrix = {};
  for (const role of MATRIX_ROLES) {
    assertKnownRole(role);
    const permissions = migratePermissionKeys(record[role] || []);
    for (const permission of permissions) assertKnownPermission(permission);
    matrix[role] = new Set(permissions);
  }
  return matrix;
}

export function matrixHasPermission(matrix, role, permission) {
  return matrix[role]?.has(permission) ?? false;
}

export function diffRoleMatrices(fromMatrix, toMatrix) {
  const changes = [];
  for (const role of MATRIX_ROLES) {
    for (const permission of PERMISSIONS) {
      const before = matrixHasPermission(fromMatrix, role, permission);
      const after = matrixHasPermission(toMatrix, role, permission);
      if (before === after) continue;
      changes.push({ role, permission, before, after });
    }
  }
  return changes;
}

/** Resolve role bundle for one role, preferring a stored matrix over code baseline. */
export function getRoleBundle(role, roleMatrix = null) {
  if (roleMatrix?.[role]) return new Set(roleMatrix[role]);
  return new Set(ROLE_PERMISSIONS[role] || []);
}

/** Union of all role-bundle grants for a user (no per-user deltas). */
export function getRoleBaselinePermissions(user, roleMatrix = null) {
  const perms = new Set();
  for (const role of getUserRoles(user)) {
    for (const permission of getRoleBundle(role, roleMatrix)) perms.add(permission);
  }
  return perms;
}

export function roleBaselineHasPermission(user, permission, roleMatrix = null) {
  return getRoleBaselinePermissions(user, roleMatrix).has(permission);
}

export function normaliseUserOverrides(overrides = {}) {
  const normalised = {};
  for (const [permission, state] of Object.entries(overrides || {})) {
    const resolved = resolvePermissionKey(permission);
    if (!OVERRIDE_EDITABLE_PERMISSIONS.includes(resolved)) {
      throw new Error(`Permission is not overrideable: ${permission}`);
    }
    assertKnownPermission(resolved);
    assertOverrideState(state);
    normalised[resolved] = state;
  }
  return normalised;
}

/**
 * Effective grants = role baseline with per-user allow/deny deltas applied.
 * Deny wins over baseline; allow can add permissions not in the role bundle.
 */
export function getEffectivePermissions(user, { roleMatrix = null, userOverrides = {} } = {}) {
  const effective = new Set(getRoleBaselinePermissions(user, roleMatrix));
  const deltas = normaliseUserOverrides(userOverrides);
  for (const [permission, delta] of Object.entries(deltas)) {
    if (delta === 'allow') effective.add(permission);
    else if (delta === 'deny') effective.delete(permission);
  }
  return effective;
}

export function userHasEffectivePermission(
  user,
  permission,
  { roleMatrix = null, userOverrides = {}, loadFailed = false } = {},
) {
  if (loadFailed) return false;
  return getEffectivePermissions(user, { roleMatrix, userOverrides }).has(permission);
}
