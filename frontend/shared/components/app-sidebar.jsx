'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import Icon from '@/shared/components/icons.jsx';
import BrandMark from '@/shared/components/brand-mark.jsx';
import { BRAND_SHORT } from '@/shared/lib/brand.js';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/shared/components/ui/sidebar';

const NAV_GROUPS = [
  {
    cap: 'Work',
    items: [
      { href: '/tickets/board', id: 'board', label: 'Board', icon: 'board', roles: '*' },
      { href: '/tickets', id: 'tickets', label: 'Tickets', icon: 'ticket', roles: '*' },
      { href: '/tickets/analytics', id: 'analytics', label: 'Analytics', icon: 'chart', roles: ['admin', 'lead', 'qa'] },
      { href: '/notifications', id: 'inbox', label: 'Notifications', icon: 'bell', roles: '*' },
    ],
  },
  {
    cap: 'Admin',
    items: [
      { href: '/projects', id: 'projects', label: 'Projects', icon: 'layers', roles: ['admin'] },
      { href: '/teams', id: 'teams', label: 'Teams', icon: 'teams', roles: ['admin', 'lead'] },
      { href: '/users', id: 'people', label: 'People', icon: 'user', roles: ['admin'] },
      { href: '/settings/notifications', id: 'settings', label: 'Notification settings', icon: 'sliders', roles: '*' },
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

export default function AppSidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  if (!user) return null;

  return (
    <Sidebar collapsible="icon" aria-label="Primary">
      {/* The header is never unmounted, so the mark survives the collapse — at
          icon width only the wordmark folds away. */}
      <SidebarHeader className="h-(--bar-h) justify-center border-b border-sidebar-border p-0">
        <div className="flex h-(--bar-h) items-center gap-2.5 px-3.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <BrandMark id="nav" className="size-5 shrink-0" />
          <b className="truncate text-[0.8125rem] font-semibold tracking-tight text-foreground group-data-[collapsible=icon]:hidden">
            {BRAND_SHORT}
          </b>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => visible(item, user.role));
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group.cap}>
              <SidebarGroupLabel>{group.cap}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      {/* tooltip only renders at icon width, so the label stays
                          reachable once the text folds away. */}
                      <SidebarMenuButton
                        asChild
                        isActive={isCurrent(pathname, item.href)}
                        tooltip={item.label}
                      >
                        <Link href={item.href}>
                          <Icon name={item.icon} size={16} />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={logout} tooltip="Sign out">
              <Icon name="sign-out" size={16} />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Edge handle: a second, always-present way to toggle that never moves
          relative to the rail. */}
      <SidebarRail />
    </Sidebar>
  );
}
