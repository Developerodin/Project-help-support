'use client';

import { AuthProvider, useAuth } from '@/shared/contexts/auth-context.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';

function AuthBootGate({ children }) {
  const { loading } = useAuth();
  if (loading) return <AppLoader />;
  return children;
}

export default function AuthLayout({ children }) {
  return (
    <AuthProvider>
      <AuthBootGate>{children}</AuthBootGate>
    </AuthProvider>
  );
}
