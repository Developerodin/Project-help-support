// shared/permissions.js
import { ROLE_IDS, EXTERNAL_ROLES, INTERNAL_ROLES } from './enums.js';
import { PERMISSIONS, ROLE_PERMISSIONS, resolvePermissionKey, migratePermissionKeys, PERMISSION_KEY_MIGRATION } from './role-permission-bundles.js';
import { userHasEffectivePermission } from './permission-resolution.js';

export { PERMISSIONS, ROLE_PERMISSIONS, resolvePermissionKey, migratePermissionKeys, PERMISSION_KEY_MIGRATION };

export function hasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

/**
 * Resolve all active roles for a user. Prefers `roles[]`; falls back to legacy
 * `role` so existing single-role documents keep working before migration.
 */
export function getUserRoles(user) {
  if (!user) return [];
  const roles = user.roles;
  if (Array.isArray(roles) && roles.length > 0) return [...new Set(roles)];
  if (user.role) return [user.role];
  return [];
}

export function hasRole(user, role) {
  return getUserRoles(user).includes(role);
}

export function hasAnyRole(user, ...roles) {
  const userRoles = getUserRoles(user);
  return roles.some((role) => userRoles.includes(role));
}

/** Most senior role for backward-compatible `role` field and display ordering. */
export function pickPrimaryRole(roles) {
  if (!roles?.length) return ROLE_IDS.READ_ONLY;
  const unique = [...new Set(roles)];
  for (const candidate of INTERNAL_ROLES) {
    if (unique.includes(candidate)) return candidate;
  }
  for (const candidate of EXTERNAL_ROLES) {
    if (unique.includes(candidate)) return candidate;
  }
  return unique[0];
}

export function isSuperAdmin(user) {
  return hasRole(user, ROLE_IDS.SUPER_ADMIN);
}

export function isExternalUser(user) {
  return getUserRoles(user).some((role) => EXTERNAL_ROLES.includes(role));
}

function getUserPermissions(user) {
  const perms = new Set();
  for (const role of getUserRoles(user)) {
    for (const permission of ROLE_PERMISSIONS[role] || []) perms.add(permission);
  }
  return perms;
}

function isPermissionContext(value) {
  return value != null
    && typeof value === 'object'
    && ('roleMatrix' in value || 'userOverrides' in value);
}

export function can(user, permission, scopeOrContext = null) {
  if (!user) return false;
  if (isPermissionContext(scopeOrContext)) {
    return userHasEffectivePermission(user, permission, scopeOrContext);
  }
  // Scope is unused in v1's flat matrix, but this keeps call sites stable for
  // AccessAssignment-scoped authorization.
  void scopeOrContext;
  return getUserPermissions(user).has(permission);
}
