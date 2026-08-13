'use client';

import Link from 'next/link';
import { AuthProvider, useAuth } from '@/shared/contexts/auth-context.jsx';

function Nav() {
  const { user, logout } = useAuth();
  if (!user) return null;

  // Role gates NAVIGATION VISIBILITY ONLY. This is not authorization — the
  // server rejects an admin route for a member regardless of what renders here.
  const isAdmin = user.role === 'admin';
  const isLeadOrAdmin = isAdmin || user.role === 'lead';

  return (
    <nav style={{ display: 'flex', gap: 16, padding: 12, borderBottom: '1px solid var(--border)' }}>
      <Link href="/tickets">Tickets</Link>
      <Link href="/tickets/board">Board</Link>
      <Link href="/tickets/analytics">Analytics</Link>
      {isLeadOrAdmin && <Link href="/teams">Teams</Link>}
      {isAdmin && <Link href="/projects">Projects</Link>}
      {isAdmin && <Link href="/users">Users</Link>}
      <Link href="/settings/notifications">Settings</Link>
      <span style={{ marginLeft: 'auto' }}>
        {user.name} · <button type="button" onClick={logout}>Sign out</button>
      </span>
    </nav>
  );
}

function Guard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!user) return <p style={{ padding: 24 }}>Please <Link href="/login">sign in</Link>.</p>;
  return children;
}

export default function AppLayout({ children }) {
  return (
    <AuthProvider>
      <Nav />
      <main style={{ padding: 16 }}><Guard>{children}</Guard></main>
    </AuthProvider>
  );
}
