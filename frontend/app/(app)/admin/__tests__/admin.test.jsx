import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminPage from '../page.jsx';

const { authUser } = vi.hoisted(() => ({
  authUser: {
    id: 'u1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'admin',
  },
}));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({
    user: authUser,
  }),
}));

describe('AdminPage', () => {
  beforeEach(() => {
    authUser.role = 'admin';
  });

  it('renders admin hub destinations for admin-tier users', () => {
    render(<AdminPage />);

    expect(screen.getByRole('heading', { level: 1, name: /admin panel/i })).toBeInTheDocument();
    const hub = screen.getByRole('region', { name: /admin destinations/i });
    expect(hub).toBeInTheDocument();
    expect(hub.querySelector('a[href="/users"]')).toBeInTheDocument();
    expect(hub.querySelector('a[href="/projects"]')).toBeInTheDocument();
    expect(hub.querySelector('a[href="/teams"]')).toBeInTheDocument();
    expect(hub.querySelector('a[href="/settings/notifications"]')).toBeInTheDocument();
  });

  it('denies access for non-admin users', () => {
    authUser.role = 'developer';
    render(<AdminPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/access denied/i);
    expect(screen.queryByRole('region', { name: /admin destinations/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to profile/i })).toHaveAttribute('href', '/profile');
  });
});
