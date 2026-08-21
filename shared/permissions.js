// shared/permissions.js
import { ROLE_IDS, EXTERNAL_ROLES, INTERNAL_ROLES } from './enums.js';

/**
 * Permission matrix source of truth. v1 remains flat (no Client/Project/
 * Environment axis), but this file defines the long-term authorization API
 * shape so service/business logic can converge on can(user, permission, scope)
 * instead of proliferating role === ... checks.
 */
export const PERMISSIONS = Object.freeze([
  'clients.view', 'clients.manage',
  'projects.view', 'projects.manage',
  'teams.view', 'teams.manage',
  'tickets.view', 'tickets.create', 'tickets.update', 'tickets.delete', 'tickets.assign',
  'users.view', 'users.manage',
  'access.view', 'access.grant', 'access.revoke',
  'audit.view',
]);

const VIEW_ONLY = Object.freeze(['clients.view', 'projects.view', 'teams.view', 'tickets.view']);

/**
 * super_admin and admin hold the IDENTICAL bundle deliberately — the
 * containment between them ("Admin cannot manage/impersonate Admin or Super
 * Admin") is an identity-aware rule enforced in user.service.js/auth.service.js,
 * not a capability difference. See design spec §3.
 */
const FULL_ADMIN_BUNDLE = PERMISSIONS;

const PROJECT_ADMIN = Object.freeze([
  'clients.view', 'projects.view', 'projects.manage', 'teams.view', 'teams.manage',
  'tickets.view', 'tickets.create', 'tickets.update', 'tickets.assign', 'users.view',
]);

/**
 * Independently defined, not aliases of one shared constant, even though
 * their v1 shape is currently identical — see design spec §3 on why the old
 * five-role model's accidental qa/developer/member equality is exactly what
 * this avoids repeating.
 */
const DEVELOPER = Object.freeze([...VIEW_ONLY, 'tickets.create', 'tickets.update']);
const TESTER = Object.freeze([...VIEW_ONLY, 'tickets.create', 'tickets.update']);
const SUPPORT = Object.freeze([...VIEW_ONLY, 'tickets.create', 'tickets.update']);

/** Genuinely view-only — no create/update/delete/assign anywhere. */
const READ_ONLY = VIEW_ONLY;

/**
 * A person who has been invited but not yet given a job. Empty by design —
 * default deny until an admin picks a real role. Least senior, so it never
 * wins pickPrimaryRole over a role that was actually granted.
 */
const UNASSIGNED = Object.freeze([]);

/**
 * Empty, not a guessed subset of internal permissions — what a client can do
 * is computed by AccessAssignment + external auth rules, not this internal
 * bundle map. Default deny is intentional; see design spec §3.
 */
const CLIENT_BUNDLE = Object.freeze([]);

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: FULL_ADMIN_BUNDLE,
  [ROLE_IDS.ADMIN]: FULL_ADMIN_BUNDLE,
  [ROLE_IDS.PROJECT_ADMIN]: PROJECT_ADMIN,
  [ROLE_IDS.DEVELOPER]: DEVELOPER,
  [ROLE_IDS.TESTER]: TESTER,
  [ROLE_IDS.SUPPORT]: SUPPORT,
  [ROLE_IDS.READ_ONLY]: READ_ONLY,
  [ROLE_IDS.UNASSIGNED]: UNASSIGNED,
  [ROLE_IDS.CLIENT]: CLIENT_BUNDLE,
  [ROLE_IDS.CLIENT_TESTER]: CLIENT_BUNDLE,
});

// EXTERNAL_ROLES both resolve to the same empty bundle — asserted here so a
// future edit that adds a permission to one of PERMISSIONS can't silently
// leave one external role's mapping missing.
for (const role of EXTERNAL_ROLES) {
  if (!(role in ROLE_PERMISSIONS)) throw new Error(`${role} is missing from ROLE_PERMISSIONS`);
}

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

export function can(user, permission, scope = null) {
  if (!user) return false;
  // Scope is unused in v1's flat matrix, but this keeps call sites stable for
  // AccessAssignment-scoped authorization.
  void scope;
  return getUserPermissions(user).has(permission);
}
