import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ROLE_PERMISSIONS, DEFAULT_BOARD_ROLE_POLICY, MATRIX_ROLES, BOARD_KEYS } from '@pms/shared';
import RoleDetailPage from '../page.jsx';

let currentRole = 'read_only';
const getRoleMatrix = vi.fn();
const updateRoleMatrix = vi.fn();
const getBoardPermissions = vi.fn();
const updateBoardPermissions = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ role: currentRole }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/settings/rbac-preview/matrix/x',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/shared/api/rbac.js', () => ({
  getRoleMatrix: (...a) => getRoleMatrix(...a),
  updateRoleMatrix: (...a) => updateRoleMatrix(...a),
  resetRoleMatrix: vi.fn(),
  getBoardPermissions: (...a) => getBoardPermissions(...a),
  updateBoardPermissions: (...a) => updateBoardPermissions(...a),
  resetBoardPermissions: vi.fn(),
}));
vi.mock('@/shared/lib/toast.js', () => ({ showToast: vi.fn() }));

const matrixRecord = () => Object.fromEntries(MATRIX_ROLES.map((r) => [r, [...(ROLE_PERMISSIONS[r] || [])]]));
const boardRecord = () => Object.fromEntries(MATRIX_ROLES.map((r) => [
  r, Object.fromEntries(BOARD_KEYS.map((b) => [b, [...(DEFAULT_BOARD_ROLE_POLICY[r]?.[b] || [])]])),
]));

let consoleErrors = [];

describe('RBAC role detail — DOM lifecycle across state transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrors = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => { consoleErrors.push(a.join(' ')); });
    getRoleMatrix.mockResolvedValue({ baseline: matrixRecord(), effective: matrixRecord() });
    getBoardPermissions.mockResolvedValue({ baseline: boardRecord(), effective: boardRecord() });
    updateRoleMatrix.mockImplementation(async ({ grants }) => ({ effective: { ...matrixRecord(), ...grants } }));
    updateBoardPermissions.mockResolvedValue({ effective: boardRecord() });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const enterEdit = async (user) => user.click(await screen.findByRole('button', { name: 'Edit draft' }));
  const backToView = async (user) => user.click(screen.getByRole('button', { name: 'View saved' }));

  it('client_tester: toggling External ticket workflow across view/edit does not corrupt the DOM', async () => {
    currentRole = 'client_tester';
    const user = userEvent.setup();
    const { unmount } = render(<RoleDetailPage />);

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await enterEdit(user);
      // eslint-disable-next-line no-await-in-loop
      const sw = await screen.findByRole('switch', { name: /Allow ticket acceptance/ });
      // eslint-disable-next-line no-await-in-loop
      await user.click(sw);
      // eslint-disable-next-line no-await-in-loop
      await backToView(user);
    }
    expect(screen.queryByRole('heading', { name: 'Board permissions' })).not.toBeInTheDocument();
    unmount();
    expect(consoleErrors.filter((e) => /removeChild|validateDOMNesting|not a child/i.test(e))).toEqual([]);
  });

  it('switching between internal and external roles remounts cleanly', async () => {
    const user = userEvent.setup();
    for (const role of ['read_only', 'client_tester', 'developer', 'client', 'tester']) {
      currentRole = role;
      // eslint-disable-next-line no-await-in-loop
      const { unmount } = render(<RoleDetailPage />);
      // eslint-disable-next-line no-await-in-loop
      await enterEdit(user);
      // eslint-disable-next-line no-await-in-loop
      await backToView(user);
      unmount();
    }
    expect(consoleErrors.filter((e) => /removeChild|validateDOMNesting|not a child/i.test(e))).toEqual([]);
  });

  it('switching role in place (same route segment) does not corrupt the DOM', async () => {
    currentRole = 'read_only';
    const user = userEvent.setup();
    const { rerender } = render(<RoleDetailPage />);
    await enterEdit(user);
    await user.click(await screen.findByRole('checkbox', { name: /^Tickets: Create\./ }));

    // Next reuses this component instance when only [role] changes.
    for (const role of ['client_tester', 'developer', 'client', 'read_only']) {
      currentRole = role;
      rerender(<RoleDetailPage />);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    }
    expect(consoleErrors.filter((e) => /removeChild|validateDOMNesting|not a child/i.test(e))).toEqual([]);
  });

  it('client_tester: save persists tickets.accept and returns to view', async () => {
    currentRole = 'client_tester';
    const user = userEvent.setup();
    render(<RoleDetailPage />);
    await enterEdit(user);
    await user.click(await screen.findByRole('switch', { name: /Allow ticket acceptance/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateRoleMatrix).toHaveBeenCalled());
    const sent = updateRoleMatrix.mock.calls[0][0].grants.client_tester;
    expect(sent).toContain('tickets.accept');
    await waitFor(() => expect(screen.getByRole('button', { name: 'View saved' })).toHaveAttribute('aria-pressed', 'true'));
    expect(consoleErrors.filter((e) => /removeChild|validateDOMNesting|not a child/i.test(e))).toEqual([]);
  });
});
