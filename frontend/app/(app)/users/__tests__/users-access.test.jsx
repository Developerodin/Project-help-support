import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import UsersPage from '@/app/(app)/users/page.jsx';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/users',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', roles: ['admin'] },
    startImpersonation: vi.fn(),
  }),
}));

vi.mock('@/shared/api/users.js', () => ({
  listUsers: vi.fn(),
  inviteUser: vi.fn(),
  patchUser: vi.fn(),
  resendInvite: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('@/shared/api/clients.js', () => ({
  listClients: vi.fn(),
}));

vi.mock('@/shared/api/projects.js', () => ({
  listProjects: vi.fn(),
}));

vi.mock('@/shared/api/rbac.js', () => ({
  listUserScopedAssignments: vi.fn(),
  createUserScopedAssignment: vi.fn(),
  revokeScopedAssignment: vi.fn(),
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

import { listUsers } from '@/shared/api/users.js';
import { listClients } from '@/shared/api/clients.js';
import { listProjects } from '@/shared/api/projects.js';
import { listUserScopedAssignments } from '@/shared/api/rbac.js';

const sampleUser = {
  id: 'user-1',
  name: 'Alice Example',
  email: 'alice@example.com',
  status: 'active',
  roles: ['developer'],
};

describe('UsersPage scoped access wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUsers.mockResolvedValue({ results: [sampleUser] });
    listClients.mockResolvedValue({ results: [{ id: 'c1', name: 'Acme' }] });
    listProjects.mockResolvedValue({ results: [{ id: 'p1', name: 'Portal', client: 'c1' }] });
    listUserScopedAssignments.mockResolvedValue({ assignments: [] });
  });

  it('opens the production access drawer from People', async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText('Alice Example')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Manage access' }));

    await waitFor(() => {
      expect(screen.getByText('Access profile — Alice Example')).toBeInTheDocument();
    });

    expect(listClients).toHaveBeenCalled();
    expect(listProjects).toHaveBeenCalled();
    expect(listUserScopedAssignments).toHaveBeenCalledWith('user-1');
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeInTheDocument();
    expect(screen.queryByText('Per-user overrides')).not.toBeInTheDocument();
  });
});
