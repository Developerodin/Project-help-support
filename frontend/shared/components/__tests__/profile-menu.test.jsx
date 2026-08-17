import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileMenu from '../profile-menu.jsx';

const { authUser, pathnameState, push } = vi.hoisted(() => ({
  authUser: {
    id: 'u1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'admin',
  },
  pathnameState: { value: '/tickets' },
  push: vi.fn(),
}));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({
    user: authUser,
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameState.value,
  useRouter: () => ({ push }),
}));

describe('ProfileMenu', () => {
  beforeEach(() => {
    authUser.id = 'u1';
    authUser.name = 'Ada Lovelace';
    authUser.email = 'ada@example.com';
    authUser.role = 'admin';
    pathnameState.value = '/tickets';
    push.mockReset();
  });

  it('opens avatar menu and includes personal information navigation', async () => {
    const user = userEvent.setup();
    render(<ProfileMenu />);

    const trigger = screen.getByRole('button', { name: /open profile menu/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const personalInformationLink = screen.getByRole('menuitem', { name: /personal information/i });
    expect(personalInformationLink).toHaveAttribute('href', '/profile#profile-personal-information');
    expect(screen.getByRole('menuitem', { name: /profile overview/i })).toHaveAttribute('href', '/profile');
  });

  it('shows admin panel toggle for admin-tier users only', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProfileMenu />);

    await user.click(screen.getByRole('button', { name: /open profile menu/i }));
    expect(screen.getByRole('menuitemcheckbox', { name: /switch to admin panel/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open profile menu/i }));

    authUser.role = 'member';
    rerender(<ProfileMenu />);
    await user.click(screen.getByRole('button', { name: /open profile menu/i }));
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
  });

  it('routes between user and admin panel areas from the toggle', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProfileMenu />);

    await user.click(screen.getByRole('button', { name: /open profile menu/i }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /switch to admin panel/i }));
    expect(push).toHaveBeenCalledWith('/users');

    pathnameState.value = '/users';
    rerender(<ProfileMenu />);
    await user.click(screen.getByRole('button', { name: /open profile menu/i }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /switch to user panel/i }));
    expect(push).toHaveBeenCalledWith('/profile');
  });
});
