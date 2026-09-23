import { ROLE_IDS } from './enums.js';
import { can, hasAnyRole, isExternalUser } from './permissions.js';
import { anyScopedAssignmentGrants } from './scoped-authorization.js';
import { canAccessProjectsModule, canManageProjectsModule } from './permission-matrix-ui.js';

/**
 * Which app pages a user may open. One copy, used by the web app's route guard
 * and sidebar and by the assistant's navigation, so they can never disagree.
 */

/** Deny-by-default only when the permission matrix explicitly failed to load. */
function normalizeContext(permissionContext) {
  if (!permissionContext) return null;
  if (permissionContext.loadFailed) return { loadFailed: true };
  return permissionContext;
}

/** Ticket routes: matrix grant, scoped assignment, or external AccessAssignment (backend enforces row scope). */
function ticketRouteAccess(user, ctx) {
  if (isExternalUser(user)) return true;
  if (ctx?.loadFailed) return false;
  const matrixCtx = ctx ?? undefined;
  if (can(user, 'tickets.view', matrixCtx)) return true;
  return ctx ? anyScopedAssignmentGrants('tickets.view', ctx) : false;
}

/** UI & QA routes: matrix grant, scoped assignment, or external scope (backend enforces). */
function uiQaRouteAccess(user, ctx) {
  if (isExternalUser(user)) return true;
  if (ctx?.loadFailed) return false;
  const matrixCtx = ctx ?? undefined;
  if (can(user, 'ui_qa.view', matrixCtx)) return true;
  return ctx ? anyScopedAssignmentGrants('ui_qa.view', ctx) : false;
}

function internalTeamAccess(permission) {
  return (user, ctx) => !ctx?.loadFailed && !isExternalUser(user) && can(user, permission, ctx ?? undefined);
}

function internalProjectsView(user, ctx) {
  return !ctx?.loadFailed && !isExternalUser(user) && canAccessProjectsModule(user, ctx ?? undefined);
}

function internalProjectsManage(user, ctx) {
  return !ctx?.loadFailed && !isExternalUser(user) && canManageProjectsModule(user, ctx ?? undefined);
}

/**
 * Ordered route rules — first match wins. Unmatched paths are open to any
 * authenticated user (profile, notifications, notification settings, etc.).
 */
const ROUTE_RULES = [
  { match: /^\/teams\/new\/?$/, access: internalTeamAccess('teams.create') },
  { match: /^\/teams\/[^/]+\/edit\/?$/, access: internalTeamAccess('teams.edit') },
  { match: /^\/teams(\/|$)/, access: internalTeamAccess('teams.view') },
  { match: /^\/projects\/new\/?$/, access: internalProjectsManage },
  { match: /^\/projects\/[^/]+\/edit\/?$/, access: internalProjectsManage },
  { match: /^\/projects(\/|$)/, access: internalProjectsView },
  { match: /^\/users(\/|$)/, access: (user, ctx) => !ctx?.loadFailed && can(user, 'users.view', ctx ?? undefined) },
  { match: /^\/audit-log(\/|$)/, access: (user, ctx) => !ctx?.loadFailed && can(user, 'audit.view', ctx ?? undefined) },
  { match: /^\/settings\/rbac-preview(\/|$)/, access: (user, ctx) => !ctx?.loadFailed && can(user, 'users.manage', ctx ?? undefined) },
  { match: /^\/admin(\/|$)/, access: (user, ctx) => !ctx?.loadFailed && can(user, 'users.manage', ctx ?? undefined) },
  {
    match: /^\/tickets\/analytics(\/|$)/,
    access: (user, ctx) => !ctx?.loadFailed && hasAnyRole(
      user,
      ROLE_IDS.SUPER_ADMIN,
      ROLE_IDS.ADMIN,
      ROLE_IDS.PROJECT_ADMIN,
      ROLE_IDS.TESTER,
    ),
  },
  { match: /^\/tickets\/new\/?$/, access: (user, ctx) => !ctx?.loadFailed && (can(user, 'tickets.create', ctx ?? undefined) || isExternalUser(user)) },
  { match: /^\/tickets\/[^/]+\/edit\/?$/, access: (user, ctx) => !ctx?.loadFailed && (can(user, 'tickets.edit', ctx ?? undefined) || isExternalUser(user)) },
  { match: /^\/tickets(\/|$)/, access: ticketRouteAccess },
  { match: /^\/ui-qa(\/|$)/, access: uiQaRouteAccess },
];

export function canAccessRoute(pathname, user, permissionContext = null) {
  if (!user) return false;
  const ctx = normalizeContext(permissionContext);
  const path = pathname.split('?')[0];
  for (const rule of ROUTE_RULES) {
    if (rule.match.test(path)) return rule.access(user, ctx);
  }
  return true;
}
