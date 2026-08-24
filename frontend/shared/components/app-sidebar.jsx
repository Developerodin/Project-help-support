'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { NAV_GROUPS, canAccessNavItem } from '@/shared/lib/route-permissions.js';
import { formatBrandDisplayName } from '@/shared/lib/branding.js';
import Icon from '@/shared/components/icons.jsx';
import BrandMark from '@/shared/components/brand-mark.jsx';
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

function isCurrent(pathname, href) {
  if (href === '/tickets') return pathname === '/tickets' || pathname.startsWith('/tickets?');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppSidebar() {
  const { user, logout, effectiveBranding } = useAuth();
  const pathname = usePathname();
  if (!user) return null;

  return (
    <Sidebar collapsible="icon" aria-label="Primary">
      <SidebarHeader className="h-(--bar-h) justify-center border-b border-sidebar-border p-0">
        <div className="flex h-(--bar-h) items-center gap-2.5 px-3.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <BrandMark className="size-5 shrink-0" logoUrl={effectiveBranding?.logoUrl} />
          <b className="truncate text-[0.8125rem] font-semibold tracking-tight text-foreground group-data-[collapsible=icon]:hidden">
            {formatBrandDisplayName(effectiveBranding?.name)}
          </b>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => canAccessNavItem(item.href, user));
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group.cap}>
              <SidebarGroupLabel>{group.cap}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.id}>
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

      <SidebarRail />
    </Sidebar>
  );
}
