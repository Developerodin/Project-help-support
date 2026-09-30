import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PEOPLE_ASSIGNABLE_ROLES, ROLE_IDS } from '@pms/shared';
import InviteDialog from '../invite-dialog.jsx';

describe('InviteDialog', () => {
  it('renders assignable roles with ROLE_LABELS via capRole', () => {
    render(
      <InviteDialog
        open
        email="a@b.com"
        role={ROLE_IDS.CLIENT}
        roles={PEOPLE_ASSIGNABLE_ROLES}
        onEmailChange={vi.fn()}
        onRoleChange={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const roleGroup = screen.getByRole('group', { name: /^roles$/i });
    const checkboxes = within(roleGroup).getAllByRole('checkbox');
    const labels = checkboxes.map((cb) => cb.closest('label').textContent.trim());

    expect(labels).not.toContain('Super Admin');
    expect(labels).not.toContain('Read Only');
    expect(labels).toContain('Client');
    expect(labels).toContain('Client Tester');
    expect(within(roleGroup).getByRole('checkbox', { name: 'Client' })).toBeInTheDocument();
    expect(within(roleGroup).getByRole('checkbox', { name: 'Client Tester' })).toBeInTheDocument();
  });

  it('calls onRoleChange when a different role is selected', async () => {
    const onRoleChange = vi.fn();
    render(
      <InviteDialog
        open
        email="a@b.com"
        role={ROLE_IDS.DEVELOPER}
        roles={PEOPLE_ASSIGNABLE_ROLES}
        onEmailChange={vi.fn()}
        onRoleChange={onRoleChange}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const roleGroup = screen.getByRole('group', { name: /^roles$/i });
    await userEvent.click(within(roleGroup).getByRole('checkbox', { name: 'Client' }));
    expect(onRoleChange).toHaveBeenCalled();
  });
});
