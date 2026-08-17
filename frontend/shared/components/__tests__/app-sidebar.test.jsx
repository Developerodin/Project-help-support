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

  it('shows Teams but not Projects or People to a Project Admin', () => {
    authUser.role = 'project_admin';
    renderSidebar();

    expect(screen.getByRole('link', { name: /teams/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /projects/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /people/i })).not.toBeInTheDocument();
  });

  it('shows Analytics to a Tester', () => {
    authUser.role = 'tester';
    renderSidebar();

    expect(screen.getByRole('link', { name: /analytics/i })).toBeInTheDocument();
  });

  it('hides privileged Admin nav links from a Developer', () => {
    authUser.role = 'developer';
    renderSidebar();

    expect(screen.queryByRole('link', { name: /projects/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /teams/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /people/i })).not.toBeInTheDocument();
  });

  it('hides privileged Admin nav links and Analytics from a Client', () => {
    authUser.role = 'client';
    renderSidebar();

    expect(screen.queryByRole('link', { name: /projects/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /analytics/i })).not.toBeInTheDocument();
  });
});
