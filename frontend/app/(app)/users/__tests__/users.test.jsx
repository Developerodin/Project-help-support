import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from '../page.jsx';

const listUsers = vi.fn();
const inviteUser = vi.fn();
const patchUser = vi.fn();
const resendInvite = vi.fn();
const deleteUser = vi.fn();

vi.mock('@/shared/api/users.js', () => ({
  listUsers: (...a) => listUsers(...a),
  inviteUser: (...a) => inviteUser(...a),
  patchUser: (...a) => patchUser(...a),
  resendInvite: (...a) => resendInvite(...a),
  deleteUser: (...a) => deleteUser(...a),
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

describe('UsersPage', () => {
  beforeEach(() => {
    listUsers.mockReset().mockResolvedValue({
      results: [
        { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'developer', status: 'active' },
        { id: 'u2', name: '', email: 'p@example.com', role: 'member', status: 'invited' },
      ],
      totalResults: 2,
    });
    inviteUser.mockReset().mockResolvedValue({ id: 'u3' });
    patchUser.mockReset().mockResolvedValue({});
    resendInvite.mockReset().mockResolvedValue({ status: 'ok', sent: true });
    deleteUser.mockReset().mockResolvedValue({ status: 'deleted' });
  });

  it('lists users with their role and status', async () => {
    render(<UsersPage />);

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('invited')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^invite$/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('invites a user and never displays an invite token', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^email$/i), 'new@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(inviteUser).toHaveBeenCalledWith({
      email: 'new@example.com', role: 'member',
    }));
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
  });

  it('shows loading on send invite while the request is in flight', async () => {
    let resolveInvite;
    inviteUser.mockImplementation(() => new Promise((resolve) => { resolveInvite = resolve; }));

    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^email$/i), 'new@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: /send invite/i }));

    expect(within(dialog).getByRole('button', { name: /sending/i })).toBeDisabled();
    resolveInvite({ id: 'u3' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('deactivating goes through PATCH after confirmation', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getAllByRole('button', { name: /^deactivate$/i })[0]);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/deactivate developer/i)).toBeInTheDocument();

    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^deactivate$/i }));
    await waitFor(() => expect(patchUser).toHaveBeenCalledWith('u1', { status: 'inactive' }));
  });

  it('deleting an active user goes through DELETE after confirmation', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/delete ada\?/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('u1'));
  });

  it('deleting an invited user goes through DELETE after confirmation', async () => {
    render(<UsersPage />);
    await screen.findByRole('button', { name: /^resend$/i });

    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[1]);
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('u2'));
  });

  it('resend invite shows loading then calls the API', async () => {
    let resolveResend;
    resendInvite.mockImplementation(() => new Promise((resolve) => { resolveResend = resolve; }));

    render(<UsersPage />);
    await screen.findByRole('button', { name: /^resend$/i });

    await userEvent.click(screen.getByRole('button', { name: /^resend$/i }));
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();

    resolveResend({ status: 'ok', sent: true });
    await waitFor(() => expect(resendInvite).toHaveBeenCalledWith('u2'));
    expect(await screen.findByRole('status')).toHaveTextContent(/invite sent/i);
  });

  it('resend invite shows an informative message when nothing was sent', async () => {
    resendInvite.mockResolvedValue({ status: 'ok', sent: false });

    render(<UsersPage />);
    await screen.findByRole('button', { name: /^resend$/i });

    await userEvent.click(screen.getByRole('button', { name: /^resend$/i }));
    await waitFor(() => expect(resendInvite).toHaveBeenCalledWith('u2'));
    expect(await screen.findByRole('status')).toHaveTextContent(/no invite sent/i);
  });
});
