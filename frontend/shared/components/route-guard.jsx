'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { canAccessRoute, getDefaultRedirect } from '@/shared/lib/route-permissions.js';
import { usePermissionContext } from '@/shared/hooks/use-permission-context.js';
import AppLoader from '@/shared/components/app-loader.jsx';

/**
 * Central route permission gate. Blocks render (and child data fetches) until
 * the current user may access the pathname; redirects silently otherwise.
 */
export default function RouteGuard({ children }) {
  const { user, loading, sessionNotice, clearSessionNotice } = useAuth();
  const { permissionContext, loading: permissionLoading } = usePermissionContext();
  const pathname = usePathname();
  const router = useRouter();
  const ctx = permissionContext.loadFailed ? null : permissionContext;

  const allowed = Boolean(user) && canAccessRoute(pathname, user, ctx);

  useEffect(() => {
    if (loading || permissionLoading || !user) return;
    if (canAccessRoute(pathname, user, ctx)) return;
    const target = getDefaultRedirect(user, ctx);
    if (pathname !== target) router.replace(target);
  }, [loading, permissionLoading, user, pathname, router, ctx]);

  // The notice exists to label this gate while it blocks. Once the new session
  // can see where it landed, the switch is over.
  useEffect(() => {
    if (allowed && sessionNotice) clearSessionNotice();
  }, [allowed, sessionNotice, clearSessionNotice]);

  if (loading || permissionLoading) return <AppLoader />;
  if (!allowed) {
    const label = sessionNotice || 'Redirecting…';
    return <AppLoader inline label={label} ariaLabel={label} />;
  }

  return children;
}
