'use client';

import { useAuth, AUTH_REQUIRED, AUTH_EXPIRED, AUTH_SIGNED_OUT } from '@/shared/contexts/auth-context.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import AuthRequiredScreen from './auth-required-screen.jsx';
import SessionExpiredScreen from './session-expired-screen.jsx';

export function AuthBootGate({ children }) {
  const { loading } = useAuth();
  if (loading) return <AppLoader />;
  return children;
}

export function AuthGuard({ children }) {
  const { status } = useAuth();
  // Signing out navigates to /login; until it lands, don't say the session died.
  if (status === AUTH_SIGNED_OUT) return <AppLoader />;
  if (status === AUTH_REQUIRED) return <AuthRequiredScreen />;
  const expired = status === AUTH_EXPIRED;
  return (
    <>
      <div
        className={expired ? 'auth-expired-host' : 'auth-workspace-host'}
        inert={expired || undefined}
        aria-hidden={expired || undefined}
      >
        {children}
      </div>
      {expired ? <SessionExpiredScreen /> : null}
    </>
  );
}
