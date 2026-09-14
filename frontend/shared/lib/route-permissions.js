import {
  can,
  isExternalUser,
  hasAnyRole,
  ROLE_IDS,
  canAccessProjectsModule,
  canManageProjectsModule,
  anyScopedAssignmentGrants,
} from '@pms/shared';
import { permissionContextForUi } from '@/shared/lib/permission-context-ui.js';

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

/** First accessible destination when blocking an unauthorized route. */
export const REDIRECT_CANDIDATES = [
  '/tickets/board',
  '/tickets',
  '/notifications',
  '/profile',
  '/projects',
  '/teams',
  '/users',
  '/audit-log',
  '/settings/notifications',
  '/admin',
];

export function canAccessRoute(pathname, user, permissionContext = null) {
  if (!user) return false;
  const ctx = permissionContextForUi(permissionContext);
  const path = pathname.split('?')[0];
  for (const rule of ROUTE_RULES) {
    if (rule.match.test(path)) return rule.access(user, ctx);
  }
  return true;
}

export function getDefaultRedirect(user, permissionContext = null) {
  if (!user) return '/login';
  for (const path of REDIRECT_CANDIDATES) {
    if (canAccessRoute(path, user, permissionContext)) return path;
  }
  return '/profile';
}

/** Sidebar nav — href visibility uses the same route checks as the guard. */
export const NAV_GROUPS = [
  {
    cap: 'Work',
    items: [
      { href: '/tickets/board', id: 'board', label: 'Board', icon: 'board' },
      { href: '/tickets', id: 'tickets', label: 'Tickets', icon: 'ticket' },
      { href: '/tickets/analytics', id: 'analytics', label: 'Analytics', icon: 'chart' },
      { href: '/notifications', id: 'inbox', label: 'Notifications', icon: 'bell' },
      { href: '/ui-qa', id: 'ui-qa', label: 'UI & QA', icon: 'eye' },
    ],
  },
  {
    cap: 'Admin',
    items: [
      { href: '/projects', id: 'projects', label: 'Projects', icon: 'layers' },
      { href: '/teams', id: 'teams', label: 'Teams', icon: 'teams' },
      { href: '/users', id: 'people', label: 'People', icon: 'user' },
      { href: '/audit-log', id: 'audit-log', label: 'Audit log', icon: 'list' },
      { href: '/settings/rbac-preview/matrix', id: 'rbac-preview', label: 'User roles', icon: 'lock' },
      { href: '/settings/notifications', id: 'settings', label: 'Notification settings', icon: 'sliders' },
    ],
  },
];

export function canAccessNavItem(href, user, permissionContext = null) {
  return canAccessRoute(href, user, permissionContext);
}
