'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { canAccessRoute, getDefaultRedirect } from '@/shared/lib/route-permissions.js';
import AppLoader from '@/shared/components/app-loader.jsx';

/**
 * Central route permission gate. Blocks render (and child data fetches) until
 * the current user may access the pathname; redirects silently otherwise.
 */
export default function RouteGuard({ children }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const allowed = Boolean(user) && canAccessRoute(pathname, user);

  useEffect(() => {
    if (loading || !user) return;
    if (canAccessRoute(pathname, user)) return;
    const target = getDefaultRedirect(user);
    if (pathname !== target) router.replace(target);
  }, [loading, user, pathname, router]);

  if (loading) return <AppLoader />;
  if (!allowed) return <AppLoader inline label="Redirecting\u2026" ariaLabel="Redirecting" />;

  return children;
}
