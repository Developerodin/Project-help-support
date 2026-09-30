import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import AppSidebar from '@/shared/components/app-sidebar.jsx';
import { SidebarProvider } from '@/shared/components/ui/sidebar';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/users',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', roles: ['admin'] },
    logout: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/use-permission-context.js', () => ({
  usePermissionContext: () => ({
    permissionContext: { roleMatrix: null, userOverrides: {}, loadFailed: false },
    loading: false,
  }),
}));

describe('AppSidebar production RBAC navigation', () => {
  it('shows the production audit log link for admins', () => {
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );

    const auditLink = screen.getByRole('link', { name: 'Audit log' });
    expect(auditLink).toHaveAttribute('href', '/audit-log');
  });
});
