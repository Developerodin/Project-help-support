import {
  can,
  isExternalUser,
  hasAnyRole,
  ROLE_IDS,
  canAccessProjectsModule,
  canManageProjectsModule,
} from '@pms/shared';

/** Ticket routes: matrix grant or external AccessAssignment scope (backend enforces scope). */
function ticketRouteAccess(user, permissionContext) {
  return can(user, 'tickets.view', permissionContext) || isExternalUser(user);
}

/** UI & QA routes: matrix grant or external AccessAssignment scope (backend enforces scope). */
function uiQaRouteAccess(user, permissionContext) {
  return can(user, 'ui_qa.view', permissionContext) || isExternalUser(user);
}

function internalTeamAccess(permission) {
  return (user) => !isExternalUser(user) && can(user, permission);
}

function internalProjectsView(user) {
  return !isExternalUser(user) && canAccessProjectsModule(user);
}

function internalProjectsManage(user) {
  return !isExternalUser(user) && canManageProjectsModule(user);
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
  { match: /^\/users(\/|$)/, access: (user) => can(user, 'users.view') },
  { match: /^\/audit-log(\/|$)/, access: (user) => can(user, 'audit.view') },
  { match: /^\/settings\/rbac-preview(\/|$)/, access: (user) => can(user, 'users.manage') },
  { match: /^\/admin(\/|$)/, access: (user) => can(user, 'users.manage') },
  {
    match: /^\/tickets\/analytics(\/|$)/,
    access: (user) => hasAnyRole(
      user,
      ROLE_IDS.SUPER_ADMIN,
      ROLE_IDS.ADMIN,
      ROLE_IDS.PROJECT_ADMIN,
      ROLE_IDS.TESTER,
    ),
  },
  { match: /^\/tickets\/new\/?$/, access: (user, ctx) => can(user, 'tickets.create', ctx) || isExternalUser(user) },
  { match: /^\/tickets\/[^/]+\/edit\/?$/, access: (user, ctx) => can(user, 'tickets.edit', ctx) || isExternalUser(user) },
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
  const path = pathname.split('?')[0];
  for (const rule of ROUTE_RULES) {
    if (rule.match.test(path)) return rule.access(user, permissionContext);
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
