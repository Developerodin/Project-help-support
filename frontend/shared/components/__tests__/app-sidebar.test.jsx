import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppSidebar from '../app-sidebar.jsx';
import { SidebarProvider } from '@/shared/components/ui/sidebar.jsx';

const { authUser } = vi.hoisted(() => ({ authUser: { role: 'admin' } }));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({ user: authUser, logout: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets/board',
}));

vi.mock('@/shared/api/notifications.js', () => ({
  listNotifications: vi.fn().mockResolvedValue({ totalResults: 0, results: [] }),
}));

vi.mock('@/shared/hooks/use-permission-context.js', () => ({
  usePermissionContext: () => ({
    permissionContext: { roleMatrix: null, userOverrides: {}, loadFailed: false },
    loading: false,
  }),
}));

function renderSidebar() {
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

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

describe('AppSidebar', () => {
  it('shows every Admin-group item to a Super Admin', () => {
    authUser.role = 'super_admin';
    renderSidebar();

    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /teams/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /people/i })).toBeInTheDocument();
  });

  it('shows Teams to a Project Admin', () => {
    authUser.role = 'project_admin';
    renderSidebar();

    expect(screen.getByRole('link', { name: /teams/i })).toBeInTheDocument();
  });

  it('shows Analytics to a Tester', () => {
    authUser.role = 'tester';
    renderSidebar();

    expect(screen.getByRole('link', { name: /analytics/i })).toBeInTheDocument();
  });

  it('hides People from a Developer', () => {
    authUser.role = 'developer';
    renderSidebar();

    expect(screen.queryByRole('link', { name: /people/i })).not.toBeInTheDocument();
  });

  // Clients work their own tickets: the list and board show, scoped server-side
  // by their access assignment. Every admin surface stays hidden.
  it('shows a Client Tickets and Board but hides every privileged Admin link', () => {
    authUser.role = 'client';
    renderSidebar();

    expect(screen.getByRole('link', { name: /^tickets$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^board$/i })).toBeInTheDocument();
    for (const label of [/projects/i, /analytics/i, /^teams$/i, /^people$/i, /^audit log$/i, /^user roles$/i]) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
  });

  it('shows Tickets for a developer and hides them for unassigned', () => {
    authUser.role = 'developer';
    const { unmount } = renderSidebar();
    expect(screen.getByRole('link', { name: /^tickets$/i })).toBeInTheDocument();
    unmount();

    authUser.role = 'unassigned';
    renderSidebar();
    expect(screen.queryByRole('link', { name: /^tickets$/i })).not.toBeInTheDocument();
  });
});
