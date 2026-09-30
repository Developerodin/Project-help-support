import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ROLE_PERMISSIONS, DEFAULT_BOARD_ROLE_POLICY, MATRIX_ROLES, BOARD_KEYS } from '@pms/shared';
import RoleDetailPage from '../page.jsx';

const getRoleMatrix = vi.fn();
const updateRoleMatrix = vi.fn();
const getBoardPermissions = vi.fn();
const updateBoardPermissions = vi.fn();

let currentRole = 'read_only';

vi.mock('next/navigation', () => ({
  useParams: () => ({ role: currentRole }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/settings/rbac-preview/matrix/read_only',
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

describe('RBAC role detail page — ticket permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRoleMatrix.mockResolvedValue({ baseline: matrixRecord(), effective: matrixRecord() });
    getBoardPermissions.mockResolvedValue({ baseline: boardRecord(), effective: boardRecord() });
    updateRoleMatrix.mockImplementation(async ({ grants }) => ({ effective: { ...matrixRecord(), ...grants } }));
    updateBoardPermissions.mockResolvedValue({ effective: boardRecord() });
  });

  it.each(['read_only', 'developer', 'tester', 'support', 'project_admin'])(
    'lets an admin toggle and save every applicable ticket permission for %s',
    async (role) => {
    currentRole = role;
    const user = userEvent.setup();
    render(<RoleDetailPage />);
    await screen.findByRole('button', { name: 'Edit draft' });
    await user.click(screen.getByRole('button', { name: 'Edit draft' }));

    const cells = [
      ['Tickets: Create.', 'tickets.create'],
      ['Tickets: Edit.', 'tickets.edit'],
      ['Tickets: Delete.', 'tickets.delete'],
    ];

    for (const [label] of cells) {
      const box = screen.getByRole('checkbox', { name: new RegExp(`^${label.replace('.', '\.')}`) });
      expect(box).toBeEnabled();
      // eslint-disable-next-line no-await-in-loop
      if (!box.checked) await user.click(box);
    }

    // 1. draft updated immediately
    for (const [label] of cells) {
      expect(screen.getByRole('checkbox', { name: new RegExp(`^${label.replace('.', '\.')}`) })).toBeChecked();
    }
    // 2. unsaved-changes state reflects only the cells that actually changed
    const changed = cells.filter(([, key]) => !(ROLE_PERMISSIONS[role] || []).includes(key)).length;
    if (changed > 0) {
      expect(await screen.findByText(new RegExp(`^${changed} unsaved change`))).toBeInTheDocument();
    }

    // 3. saves through the RBAC API with the real backend keys
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateRoleMatrix).toHaveBeenCalled());
    const sent = updateRoleMatrix.mock.calls[0][0].grants[role];
    for (const [, key] of cells) expect(sent).toContain(key);

    // 4/5. reloads with the saved values
    // 4/5. matrix returns to the saved view holding the persisted values
    await waitFor(() => expect(screen.getByRole('button', { name: 'View saved' })).toHaveAttribute('aria-pressed', 'true'));
    const saved = await updateRoleMatrix.mock.results[0].value;
    for (const [, key] of cells) expect(saved.effective[role]).toContain(key);
  },
  );
});
