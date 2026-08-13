import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from '../page.jsx';

const listUsers = vi.fn();
const inviteUser = vi.fn();
const patchUser = vi.fn();

vi.mock('@/shared/api/users.js', () => ({
  listUsers: (...a) => listUsers(...a),
  inviteUser: (...a) => inviteUser(...a),
  patchUser: (...a) => patchUser(...a),
  resendInvite: vi.fn(),
}));

describe('UsersPage', () => {
  beforeEach(() => {
    listUsers.mockReset().mockResolvedValue({
      results: [
        { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'developer', status: 'active' },
        { id: 'u2', name: 'Pending', email: 'p@example.com', role: 'member', status: 'invited' },
      ],
      totalResults: 2,
    });
    inviteUser.mockReset().mockResolvedValue({ id: 'u3' });
    patchUser.mockReset().mockResolvedValue({});
  });

  it('lists users with their role and status', async () => {
    render(<UsersPage />);

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('invited')).toBeInTheDocument();
  });

  it('invites a user and never displays an invite token', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Person');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(inviteUser).toHaveBeenCalledWith({
      name: 'New Person', email: 'new@example.com', role: 'member',
    }));
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
  });

  it('deactivating goes through PATCH — there is no delete control', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /deactivate/i })[0]);
    await waitFor(() => expect(patchUser).toHaveBeenCalledWith('u1', { status: 'inactive' }));
  });
});
