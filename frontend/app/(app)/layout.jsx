'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/shared/contexts/auth-context.jsx';
import { ProjectProvider, useProject } from '@/shared/contexts/project-context.jsx';
import { AuthBootGate, AuthGuard } from '@/shared/components/auth/auth-guard.jsx';
import Icon from '@/shared/components/icons.jsx';
import ProfileMenu from '@/shared/components/profile-menu.jsx';
import ProjectSwitcher from '@/shared/components/project-switcher.jsx';
import NotificationBell from '@/shared/components/notification-bell.jsx';
import ThemeToggle from '@/shared/components/theme-toggle.jsx';
import AppSidebar from '@/shared/components/app-sidebar.jsx';
import ExternalWorkspaceNotice from '@/shared/components/external-workspace-notice.jsx';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/shared/components/ui/sidebar';
import { FOCUS_TICKET_SEARCH_KEY, focusTicketSearch } from '@/shared/lib/ticket-search-focus.js';
import { readNavCollapsed, storeNavCollapsed } from '@/shared/lib/nav-preference.js';

function ImpersonationBanner() {
  const { impersonation, stopImpersonation } = useAuth();
  if (!impersonation) return null;

  return (
    <div className="banner">
      <Icon name="eye" size={14} />
      <span>Viewing as this user, impersonated by {impersonation.byName}.</span>
      <span className="spacer" />
      <button type="button" className="btn btn-sm" onClick={stopImpersonation}>
        Stop impersonating
      </button>
    </div>
  );
}

function TopBar() {
  const { user } = useAuth();
  const { activeProject, hasWorkspace } = useProject();
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
      {hasWorkspace ? <ProjectSwitcher /> : null}
      <button type="button" className="search" onClick={openSearch} aria-label="Search tickets">
        <span className="q">{searchHint}</span>
        <kbd>/</kbd>
      </button>
      <span className="spacer" />
      {hasWorkspace ? (
        <Link href="/tickets/new" className="btn btn-primary">
          <Icon name="plus" size={12} /> New ticket
        </Link>
      ) : null}
      <NotificationBell />
      <ThemeToggle />
      <ProfileMenu />
    </div>
  );
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
        <div className="page">
          <ImpersonationBanner />
          <ExternalWorkspaceNotice />
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function AppLayout({ children }) {
  return (
    <AuthProvider>
      <AuthBootGate>
        <AuthGuard>
          <ProjectProvider>
            <AppShell>{children}</AppShell>
          </ProjectProvider>
        </AuthGuard>
      </AuthBootGate>
    </AuthProvider>
  );
}
