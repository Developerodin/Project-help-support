import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfilePage from '../page.jsx';

const { authUser, logout, refreshUser, updateMe, listTeams, listProjects, writeText } = vi.hoisted(() => ({
  authUser: {
    id: '507f1f77bcf86cd799439011',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'admin',
    status: 'active',
    kind: 'internal',
    lastLoginAt: '2026-08-16T10:00:00.000Z',
    createdAt: '2026-01-15T00:00:00.000Z',
  },
  logout: vi.fn(),
  refreshUser: vi.fn(),
  updateMe: vi.fn(),
  listTeams: vi.fn(),
  listProjects: vi.fn(),
  writeText: vi.fn(),
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

vi.mock('@/shared/api/teams.js', () => ({
  listTeams,
}));

vi.mock('@/shared/api/projects.js', () => ({
  listProjects,
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

vi.mock('@/shared/contexts/theme-context.jsx', () => ({
  useTheme: () => ({ theme: 'light', isLight: true, setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));

describe('ProfilePage', () => {
  beforeEach(() => {
    updateMe.mockReset().mockResolvedValue({
      id: authUser.id,
      name: 'Ada L.',
      email: authUser.email,
      role: 'admin',
      status: 'active',
    });
    logout.mockReset().mockResolvedValue(undefined);
    refreshUser.mockReset().mockResolvedValue(authUser);
    listTeams.mockReset().mockResolvedValue({
      results: [
        {
          id: 't1',
          name: 'Platform',
          lead: { id: authUser.id },
          members: [],
          projects: [{ id: 'p1', key: 'PLT', name: 'Platform App' }],
        },
      ],
    });
    listProjects.mockReset().mockResolvedValue({ totalResults: 3, results: [] });
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('renders profile header and core sections', async () => {
    render(<ProfilePage />);

    expect(screen.getByRole('heading', { name: /your profile/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /profile overview/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /personal information/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /work profile/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /access and permissions/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /security/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^account$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /preferences/i })).toBeInTheDocument();

    await waitFor(() => expect(listTeams).toHaveBeenCalled());
    expect(screen.getAllByText('Platform').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PLT').length).toBeGreaterThan(0);
  });

  it('exposes a stable personal information anchor target', () => {
    render(<ProfilePage />);

    expect(document.getElementById('profile-personal-information')).toBeInTheDocument();
  });

  it('renders editable full name and read-only email', () => {
    render(<ProfilePage />);

    expect(screen.getByLabelText(/full name/i)).toHaveValue('Ada Lovelace');
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('readonly');
  });

  it('saves an updated display name', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    const nameInput = screen.getByLabelText(/full name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Ada L.');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ name: 'Ada L.' }));
    expect(refreshUser).toHaveBeenCalled();
  });

  it('opens the read-only access details drawer', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: /view access details/i }));
    expect(screen.getByRole('dialog', { name: /access details/i })).toBeInTheDocument();
    expect(screen.getByText(/client-level access control is planned/i)).toBeInTheDocument();
  });

  it('copies the masked account id', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    const copyButton = screen.getByRole('button', { name: /copy full account id/i });
    expect(copyButton).toHaveTextContent('Copy');
    await user.click(copyButton);
    await waitFor(() => expect(copyButton).toHaveTextContent('Copied'));
  });

  it('signs out from the profile page', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('links to notification settings and password reset', () => {
    render(<ProfilePage />);

    expect(screen.getByRole('link', { name: /manage/i })).toHaveAttribute('href', '/settings/notifications');
    expect(screen.getByRole('link', { name: /change password/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('shows admin panel shortcuts for admin-tier users only', () => {
    const { rerender } = render(<ProfilePage />);

    expect(screen.getByRole('heading', { name: /admin panel/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^open$/i }).map((link) => link.getAttribute('href'))).toEqual([
      '/users',
      '/projects',
      '/teams',
    ]);

    authUser.role = 'member';
    rerender(<ProfilePage />);
    expect(screen.queryByRole('heading', { name: /admin panel/i })).not.toBeInTheDocument();
  });
});
