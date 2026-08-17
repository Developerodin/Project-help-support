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

    const roleSelect = screen.getByLabelText(/^role$/i);
    const options = within(roleSelect).getAllByRole('option');
    const values = options.map((o) => o.value);

    expect(values).not.toContain(ROLE_IDS.SUPER_ADMIN);
    expect(values).not.toContain(ROLE_IDS.READ_ONLY);
    expect(values).toContain(ROLE_IDS.CLIENT);
    expect(values).toContain(ROLE_IDS.CLIENT_TESTER);
    expect(options.find((o) => o.value === ROLE_IDS.CLIENT)).toHaveTextContent('Client');
    expect(options.find((o) => o.value === ROLE_IDS.CLIENT_TESTER)).toHaveTextContent('Client Tester');
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

    await userEvent.selectOptions(screen.getByLabelText(/^role$/i), ROLE_IDS.CLIENT);
    expect(onRoleChange).toHaveBeenCalled();
  });
});
