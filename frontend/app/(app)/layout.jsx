'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/shared/contexts/auth-context.jsx';
import { ProjectProvider, useProject } from '@/shared/contexts/project-context.jsx';
import Icon, { initials } from '@/shared/components/icons.jsx';
import ProjectSwitcher from '@/shared/components/project-switcher.jsx';
import NotificationBell from '@/shared/components/notification-bell.jsx';
import ThemeToggle from '@/shared/components/theme-toggle.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import AppSidebar from '@/shared/components/app-sidebar.jsx';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/shared/components/ui/sidebar';
import { FOCUS_TICKET_SEARCH_KEY, focusTicketSearch } from '@/shared/lib/ticket-search-focus.js';
import { readNavCollapsed, storeNavCollapsed } from '@/shared/lib/nav-preference.js';

function TopBar() {
  const { user } = useAuth();
  const { activeProject } = useProject();
  const router = useRouter();
  const pathname = usePathname();

  const openSearch = useCallback(() => {
    if (pathname === '/tickets' || pathname.startsWith('/tickets?')) {
      focusTicketSearch();
      return;
    }
    try { sessionStorage.setItem(FOCUS_TICKET_SEARCH_KEY, '1'); } catch { /* ignore */ }
    router.push('/tickets');
  }, [pathname, router]);

  useEffect(() => {
    function onKey(event) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return;
      event.preventDefault();
      openSearch();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch]);

  if (!user) return null;

  const searchHint = activeProject
    ? `Search tickets, or type ${activeProject.key}-142`
    : 'Search tickets';

  return (
    <div className="topbar">
      {/* The toggle sits in the bar, not inside the panel it collapses. That
          gives it one fixed seat in both states: it cannot slide out from under
          the cursor aiming at it, and the rail can never clip it. */}
      <SidebarTrigger className="size-11 shrink-0 rounded-(--r) text-[var(--ink-3)] hover:bg-[var(--panel-2)] hover:text-[var(--ink)]" />
      <ProjectSwitcher />
      <button type="button" className="search" onClick={openSearch} aria-label="Search tickets">
        <span className="q">{searchHint}</span>
        <kbd>/</kbd>
      </button>
      <span className="spacer" />
      <Link href="/tickets/new" className="btn btn-primary">
        <Icon name="plus" size={12} /> New ticket
      </Link>
      <NotificationBell />
      <ThemeToggle />
      <div className="avatar" title={user.name}>{initials(user.name)}</div>
    </div>
  );
}

function AuthBootGate({ children }) {
  const { loading } = useAuth();
  if (loading) return <AppLoader />;
  return children;
}

function AuthGuard({ children }) {
  const { user } = useAuth();
  if (!user) {
    return (
      <div className="page">
        <p>Please <Link href="/login">sign in</Link>.</p>
      </div>
    );
  }
  return children;
}

function AppShell({ children }) {
  // Controlled, so the existing localStorage preference keeps working: the
  // provider's own cookie is read server-side, and this layout is a client
  // component, so an uncontrolled provider would forget the choice on reload.
  const [navOpen, setNavOpen] = useState(true);

  useEffect(() => {
    setNavOpen(!readNavCollapsed());
  }, []);

  const handleNavOpenChange = useCallback((open) => {
    setNavOpen(open);
    storeNavCollapsed(!open);
  }, []);

  return (
    <SidebarProvider
      open={navOpen}
      onOpenChange={handleNavOpenChange}
      style={{ '--sidebar-width': '14rem', '--sidebar-width-icon': '3.5rem' }}
    >
      <AppSidebar />
      <SidebarInset>
        <TopBar />
        <AuthGuard>
          <div className="page">{children}</div>
        </AuthGuard>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function AppLayout({ children }) {
  return (
    <AuthProvider>
      <AuthBootGate>
        <ProjectProvider>
          <AppShell>{children}</AppShell>
        </ProjectProvider>
      </AuthBootGate>
    </AuthProvider>
  );
}
