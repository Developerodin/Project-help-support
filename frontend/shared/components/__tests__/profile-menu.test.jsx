import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileMenu from '../profile-menu.jsx';

const { authUser, logout, refreshUser, updateMe } = vi.hoisted(() => ({
  authUser: {
    id: 'u1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'admin',
  },
  logout: vi.fn(),
  refreshUser: vi.fn(),
  updateMe: vi.fn(),
}));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({
    user: authUser,
    logout,
    refreshUser,
  }),
}));

vi.mock('@/shared/api/users.js', () => ({
  updateMe,
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

describe('ProfileMenu', () => {
  beforeEach(() => {
    updateMe.mockReset().mockResolvedValue({ id: 'u1', name: 'Ada L.', email: 'ada@example.com', role: 'admin' });
    logout.mockReset().mockResolvedValue(undefined);
    refreshUser.mockReset().mockResolvedValue(undefined);
  });

  it('opens a profile panel with user info', async () => {
    render(<ProfileMenu />);

    await userEvent.click(screen.getByRole('button', { name: /open profile menu/i }));

    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toHaveValue('Ada Lovelace');
  });

  it('saves an updated display name', async () => {
    const user = userEvent.setup();
    render(<ProfileMenu />);

    await user.click(screen.getByRole('button', { name: /open profile menu/i }));
    const nameInput = screen.getByLabelText(/display name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Ada L.');
    expect(nameInput).toHaveValue('Ada L.');
    await user.click(screen.getByRole('button', { name: /save name/i }));

    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ name: 'Ada L.' }));
    expect(refreshUser).toHaveBeenCalled();
  });

  it('signs out from the profile menu', async () => {
    render(<ProfileMenu />);

    await userEvent.click(screen.getByRole('button', { name: /open profile menu/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
