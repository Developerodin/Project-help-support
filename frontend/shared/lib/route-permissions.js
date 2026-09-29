import { canAccessRoute } from '@pms/shared';

// The page rules live in @pms/shared (route-access.js) so the assistant's
// navigation uses the same ones; re-exported here for existing callers.
export { canAccessRoute };

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
      { href: '/settings/notifications', id: 'notif-settings', label: 'Notification settings', icon: 'sliders' },
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
    ],
  },
];

export function canAccessNavItem(href, user, permissionContext = null) {
  return canAccessRoute(href, user, permissionContext);
}
