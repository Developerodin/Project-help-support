'use client';

import { AuthProvider } from '@/shared/contexts/auth-context.jsx';
import { AuthBootGate } from '@/shared/components/auth/auth-guard.jsx';

export default function AuthLayout({ children }) {
  return (
    <AuthProvider>
      <AuthBootGate>{children}</AuthBootGate>
    </AuthProvider>
  );
}
