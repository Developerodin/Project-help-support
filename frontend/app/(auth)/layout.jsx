'use client';

import { AuthProvider } from '@/shared/contexts/auth-context.jsx';

export default function AuthLayout({ children }) {
  return (
    <AuthProvider>
      <main style={{ maxWidth: 360, margin: '80px auto', padding: 16 }}>{children}</main>
    </AuthProvider>
  );
}
