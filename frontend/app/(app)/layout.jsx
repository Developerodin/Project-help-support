'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/shared/contexts/auth-context.jsx';
import { ProjectProvider, useProject } from '@/shared/contexts/project-context.jsx';
import Icon, { initials } from '@/shared/components/icons.jsx';
import ProjectSwitcher from '@/shared/components/project-switcher.jsx';
import NotificationBell from '@/shared/components/notification-bell.jsx';
import ThemeToggle from '@/shared/components/theme-toggle.jsx';

const NAV_GROUPS = [
  {
    cap: 'Work',
    items: [
      { href: '/tickets/board', id: 'board', label: 'Board', icon: 'board', roles: '*' },
      { href: '/tickets', id: 'tickets', label: 'Tickets', icon: 'list', roles: '*' },
      { href: '/tickets/analytics', id: 'analytics', label: 'Analytics', icon: 'chart', roles: ['admin', 'lead', 'qa'] },
      { href: '/notifications', id: 'inbox', label: 'Notifications', icon: 'bell', roles: '*' },
    ],
  },
  {
    cap: 'Admin',
    items: [
      { href: '/projects', id: 'projects', label: 'Projects', icon: 'proj', roles: ['admin'] },
      { href: '/teams', id: 'teams', label: 'Teams', icon: 'team', roles: ['admin', 'lead'] },
      { href: '/users', id: 'people', label: 'People', icon: 'user', roles: ['admin'] },
      { href: '/settings/notifications', id: 'settings', label: 'Notification settings', icon: 'bell', roles: '*' },
    ],
  },
];

function visible(item, role) {
  return item.roles === '*' || item.roles.includes(role);
}

function isCurrent(pathname, href) {
  if (href === '/tickets') return pathname === '/tickets' || pathname.startsWith('/tickets?');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function RailNav() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  if (!user) return null;

  return (
    <nav className="rail-nav" aria-label="Primary">
      <div className="brand">
        <span className="mark" aria-hidden="true"><span /><span /><span /></span>
        <b>Help &amp; Support</b>
      </div>
      <div className="navscroll">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => visible(item, user.role));
          if (items.length === 0) return null;
          return (
            <div className="navgrp" key={group.cap}>
              <span className="navcap">{group.cap}</span>
              {items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="navlink"
                  aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                >
                  <Icon name={item.icon} size={14} />
                  <span className="t">{item.label}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
      <div className="navfoot">
        <button type="button" className="navlink" onClick={logout}>
          <Icon name="x" size={14} />
          <span className="t">Sign out</span>
        </button>
      </div>
    </nav>
  );
}

function TopBar() {
  const { user } = useAuth();
  const { activeProject } = useProject();
  const router = useRouter();
  if (!user) return null;

  const searchHint = activeProject
    ? `Search tickets, or type ${activeProject.key}-142`
    : 'Search tickets';

  return (
    <div className="topbar">
      <ProjectSwitcher />
      <button type="button" className="search" onClick={() => router.push('/tickets')} aria-label="Search tickets and pages">
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

function Guard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page"><p className="meta">Loading...</p></div>;
  if (!user) {
    return (
      <div className="page">
        <p>Please <Link href="/login">sign in</Link>.</p>
      </div>
    );
  }
  return children;
}

export default function AppLayout({ children }) {
  return (
    <AuthProvider>
      <ProjectProvider>
        <div className="app">
          <RailNav />
          <main>
            <TopBar />
            <Guard>
              <div className="page">{children}</div>
            </Guard>
          </main>
        </div>
      </ProjectProvider>
    </AuthProvider>
  );
}
