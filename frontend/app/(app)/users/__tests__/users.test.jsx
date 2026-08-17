import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from '../page.jsx';

const listUsers = vi.fn();
const inviteUser = vi.fn();
const patchUser = vi.fn();
const resendInvite = vi.fn();
const deleteUser = vi.fn();
const startImpersonation = vi.fn();

const { authUser } = vi.hoisted(() => ({
  authUser: { id: 'u4', role: 'admin' },
}));

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

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({ user: authUser, startImpersonation: (...a) => startImpersonation(...a) }),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

describe('UsersPage', () => {
  beforeEach(() => {
    authUser.id = 'u4';
    authUser.role = 'admin';
    listUsers.mockReset().mockResolvedValue({
      results: [
        { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'developer', status: 'active' },
        { id: 'u2', name: '', email: 'p@example.com', role: 'read_only', status: 'invited' },
        { id: 'u4', name: 'Root', email: 'root@example.com', role: 'admin', status: 'active' },
      ],
      totalResults: 3,
    });
    inviteUser.mockReset().mockResolvedValue({ id: 'u3' });
    patchUser.mockReset().mockResolvedValue({});
    resendInvite.mockReset().mockResolvedValue({ status: 'ok', sent: true });
    deleteUser.mockReset().mockResolvedValue({ status: 'deleted' });
    startImpersonation.mockReset().mockResolvedValue({ id: 'u1' });
    push.mockReset();
  });

  it('lists users with their role and status', async () => {
    render(<UsersPage />);

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('invited')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^invite$/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the invite dialog with the caret already in the email field', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    const dialog = await screen.findByRole('dialog');
    const email = within(dialog).getByLabelText(/^email$/i);
    expect(email).toHaveFocus();

    // The old dialog focused Cancel on a 50ms timer, so anything typed inside
    // that window was thrown at a button. Type without awaiting the open.
    await userEvent.keyboard('a@b.com');
    expect(email).toHaveValue('a@b.com');
    expect(email).toHaveFocus();
  });

  it('invites a user and never displays an invite token', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^email$/i), 'new@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(inviteUser).toHaveBeenCalledWith({
      email: 'new@example.com', role: 'developer',
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

  it('impersonates an active user and navigates to the dashboard', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getAllByRole('button', { name: /^impersonate$/i })[0]);

    await waitFor(() => expect(startImpersonation).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  });

  it('hides Impersonate for the signed-in admin and invited users', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    expect(screen.getAllByRole('button', { name: /^impersonate$/i })).toHaveLength(1);
  });

  it('hides Impersonate when the signed-in user is not an admin', async () => {
    authUser.role = 'developer';
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    expect(screen.queryByRole('button', { name: /^impersonate$/i })).not.toBeInTheDocument();
  });

  it('hides the Super Admin role option from a plain Admin actor', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    const select = screen.getByLabelText('Role for Ada');
    const optionValues = within(select).getAllByRole('option').map((o) => o.value);
    expect(optionValues).not.toContain('super_admin');
    expect(optionValues).not.toContain('client');
    expect(optionValues).not.toContain('client_tester');
    expect(optionValues).not.toContain('read_only');
    expect(optionValues).toContain('admin');
    expect(optionValues).toContain('developer');
  });

  it('still hides the Super Admin role option even when the actor is a Super Admin', async () => {
    authUser.role = 'super_admin';
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    const select = screen.getByLabelText('Role for Ada');
    const optionValues = within(select).getAllByRole('option').map((o) => o.value);
    expect(optionValues).not.toContain('super_admin');
  });

  it('hides Impersonate for another Admin row when the actor is an Admin, not a Super Admin', async () => {
    listUsers.mockResolvedValue({
      results: [
        { id: 'u5', name: 'Other Admin', email: 'other-admin@example.com', role: 'admin', status: 'active' },
        { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'developer', status: 'active' },
      ],
      totalResults: 2,
    });

    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    expect(screen.getAllByRole('button', { name: /^impersonate$/i })).toHaveLength(1);
  });

  it('the invite dialog role select excludes Super Admin and external roles, using human labels', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    const dialog = await screen.findByRole('dialog');
    const roleSelect = within(dialog).getByLabelText(/^role$/i);
    const options = within(roleSelect).getAllByRole('option');

    const values = options.map((o) => o.value);
    expect(values).not.toContain('super_admin');
    expect(values).not.toContain('client');
    expect(values).not.toContain('read_only');
    const developerOption = options.find((o) => o.value === 'developer');
    expect(developerOption).toHaveTextContent('Developer');
  });

  it('shows a loading state on the Impersonate button while the request is in flight', async () => {
    let resolveImpersonate;
    startImpersonation.mockImplementation(() => new Promise((resolve) => { resolveImpersonate = resolve; }));

    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getAllByRole('button', { name: /^impersonate$/i })[0]);
    expect(screen.getByRole('button', { name: /impersonating/i })).toBeDisabled();

    resolveImpersonate({ id: 'u1' });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  });
});
