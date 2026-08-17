'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/shared/contexts/auth-context.jsx';

/**
 * `/` had no owner: (app) and (auth) are both route groups, so neither
 * contributes a URL segment and the bare origin 404'd.
 *
 * This belongs in (auth), not (app): the (app) layout's AuthGuard swaps
 * children for AuthRequiredScreen whenever there is no session, so a
 * redirect placed there would never mount for signed-out visitors — precisely
 * the case that needs it. The (auth) layout only gates on boot, then renders.
 *
 * Destinations are the ones the rest of the app already uses: /tickets after a
 * successful login, /login on logout and on a lost session.
 */
export default function RootRedirect() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    router.replace(user ? '/tickets' : '/login');
  }, [router, user]);

  // Nothing is rendered, so neither destination flashes behind the redirect.
  return null;
}
