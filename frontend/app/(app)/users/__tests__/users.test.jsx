import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from '../page.jsx';

const listUsers = vi.fn();
const inviteUser = vi.fn();
const patchUser = vi.fn();
const resendInvite = vi.fn();
const deleteUser = vi.fn();
const reactivateUser = vi.fn();
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
  reactivateUser: (...a) => reactivateUser(...a),
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({ user: authUser, startImpersonation: (...a) => startImpersonation(...a) }),
}));

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/users',
  useSearchParams: () => new URLSearchParams(),
}));

describe('UsersPage', () => {
  beforeEach(() => {
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
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
    reactivateUser.mockReset().mockResolvedValue({ reactivation: { requiresPassword: false, sent: false } });
    startImpersonation.mockReset().mockResolvedValue({ id: 'u1', role: 'developer' });
    push.mockReset();
    replace.mockReset();
  });

  it('lists users with their role and status', async () => {
    render(<UsersPage />);

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('invited', { selector: '.chip' })).toBeInTheDocument();
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
      email: 'new@example.com', roles: ['unassigned'],
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
    expect(screen.getByText(/ticket history is kept/i)).toBeInTheDocument();

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
    const resendRow = screen.getByRole('button', { name: /^resend$/i }).closest('.row-action');
    expect(await within(resendRow).findByRole('status')).toHaveTextContent(/invite sent/i);
  });

  it('resend invite shows an informative message when nothing was sent', async () => {
    resendInvite.mockResolvedValue({ status: 'ok', sent: false });

    render(<UsersPage />);
    await screen.findByRole('button', { name: /^resend$/i });

    await userEvent.click(screen.getByRole('button', { name: /^resend$/i }));
    await waitFor(() => expect(resendInvite).toHaveBeenCalledWith('u2'));
    const resendRow = screen.getByRole('button', { name: /^resend$/i }).closest('.row-action');
    expect(await within(resendRow).findByRole('status')).toHaveTextContent(/no invite sent/i);
  });

  it('impersonates an active user and lands on their own route, not the (auth) root', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getAllByRole('button', { name: /^impersonate$/i })[0]);

    await waitFor(() => expect(startImpersonation).toHaveBeenCalledWith('u1', 'Ada'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tickets/board'));
    expect(push).not.toHaveBeenCalledWith('/');
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

  it('hides protected roles but includes client roles for a plain Admin actor', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getByLabelText('Roles for Ada'));
    const panel = screen.getByRole('group', { name: 'Roles for Ada' });
    const optionLabels = within(panel).getAllByRole('checkbox')
      .map((cb) => cb.closest('label').textContent.trim());
    expect(optionLabels).not.toContain('Super Admin');
    expect(optionLabels).not.toContain('Read Only');
    expect(optionLabels).toContain('Client');
    expect(optionLabels).toContain('Client Tester');
    expect(optionLabels).toContain('Admin');
    expect(optionLabels).toContain('Developer');
  });

  it('still hides the Super Admin role option even when the actor is a Super Admin', async () => {
    authUser.role = 'super_admin';
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getByLabelText('Roles for Ada'));
    const panel = screen.getByRole('group', { name: 'Roles for Ada' });
    const optionLabels = within(panel).getAllByRole('checkbox')
      .map((cb) => cb.closest('label').textContent.trim());
    expect(optionLabels).not.toContain('Super Admin');
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

  it('the invite dialog role select includes client roles with human labels', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    const dialog = await screen.findByRole('dialog');
    const roleGroup = within(dialog).getByRole('group', { name: /^roles$/i });
    const checkboxes = within(roleGroup).getAllByRole('checkbox');
    const labels = checkboxes.map((cb) => cb.closest('label').textContent.trim());

    expect(labels).not.toContain('Super Admin');
    expect(labels).not.toContain('Read Only');
    expect(labels).toContain('Client');
    expect(labels).toContain('Client Tester');
    // Unassigned is the empty selection, not an option: nothing is checked, and
    // the dialog says so in words.
    expect(labels).not.toContain('Unassigned');
    expect(checkboxes.every((cb) => !cb.checked)).toBe(true);
    expect(within(dialog).getByText('No access yet')).toBeInTheDocument();
    expect(labels[0]).toBe('Admin');
    expect(within(roleGroup).getByRole('checkbox', { name: 'Client' })).toBeInTheDocument();
    expect(within(roleGroup).getByRole('checkbox', { name: 'Client Tester' })).toBeInTheDocument();
  });

  it('invites a user with the client_tester role', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^email$/i), 'client@example.com');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Client Tester' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(inviteUser).toHaveBeenCalledWith({
      email: 'client@example.com', roles: ['client_tester'],
    }));
  });

  it('confirms before changing roles across the internal/external boundary', async () => {
    listUsers.mockResolvedValue({
      results: [
        {
          id: 'u6',
          name: 'Harsh',
          email: 'harsh@example.com',
          roles: ['tester'],
          role: 'tester',
          status: 'active',
        },
      ],
      totalResults: 1,
    });

    render(<UsersPage />);
    await screen.findByText('harsh@example.com');

    await userEvent.click(screen.getByLabelText('Roles for Harsh'));
    const panel = screen.getByRole('group', { name: 'Roles for Harsh' });
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Client' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/may reduce their access level/i)).toBeInTheDocument();
    expect(patchUser).not.toHaveBeenCalled();

    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /change role/i }));
    await waitFor(() => expect(patchUser).toHaveBeenCalledWith('u6', { roles: ['client'] }));
  });

  it('confirms before promoting an external role to internal', async () => {
    listUsers.mockResolvedValue({
      results: [
        {
          id: 'u7',
          name: 'Client User',
          email: 'client@example.com',
          roles: ['client'],
          role: 'client',
          status: 'active',
        },
      ],
      totalResults: 1,
    });

    render(<UsersPage />);
    await screen.findByText('client@example.com');

    await userEvent.click(screen.getByLabelText('Roles for Client User'));
    const panel = screen.getByRole('group', { name: 'Roles for Client User' });
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Developer' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/much more access and control/i)).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /change role/i }));
    await waitFor(() => expect(patchUser).toHaveBeenCalledWith('u7', { roles: ['developer'] }));
  });

  it('shows Reactivate for deleted users with a preserved email', async () => {
    listUsers.mockResolvedValue({
      results: [
        {
          id: 'u8',
          name: 'Deleted User',
          email: 'deleted-user@example.com',
          roles: ['support'],
          role: 'support',
          status: 'deleted',
        },
        {
          id: 'u9',
          name: 'Scrubbed',
          email: 'deleted+6a81c91f3f865bf032201e0e@internal',
          roles: ['support'],
          role: 'support',
          status: 'deleted',
        },
      ],
      totalResults: 2,
    });

    render(<UsersPage />);
    await screen.findByText('deleted-user@example.com');

    const reactivateButtons = screen.getAllByRole('button', { name: /^reactivate$/i });
    expect(reactivateButtons).toHaveLength(1);

    await userEvent.click(reactivateButtons[0]);
    await waitFor(() => expect(reactivateUser).toHaveBeenCalledWith('u8'));
  });

  it('shows a loading state on the Impersonate button while the request is in flight', async () => {
    let resolveImpersonate;
    startImpersonation.mockImplementation(() => new Promise((resolve) => { resolveImpersonate = resolve; }));

    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    await userEvent.click(screen.getAllByRole('button', { name: /^impersonate$/i })[0]);
    expect(screen.getByRole('button', { name: /impersonating/i })).toBeDisabled();

    resolveImpersonate({ id: 'u1', role: 'developer' });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tickets/board'));
  });

  it('keeps a search that arrives in the URL (assistant, back/forward) instead of wiping it', async () => {
    render(<UsersPage />);
    await screen.findByText('ada@example.com');

    window.history.pushState(null, '', '/users?search=Prakhar');
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });

    const box = screen.getByRole('searchbox', { name: 'Search people by name or email' });
    await waitFor(() => expect(box).toHaveValue('Prakhar'));
    await new Promise((resolve) => { setTimeout(resolve, 450); }); // past the 300ms search debounce
    expect(box).toHaveValue('Prakhar');
    // Nothing may write the URL back without the search (that is what wiped it in the app).
    const wiped = window.history.replaceState.mock.calls.filter(([, , url]) => !String(url).includes('search=Prakhar'));
    expect(wiped).toEqual([]);
    window.history.pushState(null, '', '/');
  });
});
