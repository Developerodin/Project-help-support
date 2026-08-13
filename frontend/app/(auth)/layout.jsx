'use client';

import { AuthProvider } from '@/shared/contexts/auth-context.jsx';

export default function AuthLayout({ children }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}
