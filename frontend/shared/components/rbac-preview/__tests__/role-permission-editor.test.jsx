import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildRoleMatrix } from '@pms/shared';
import RolePermissionEditor from '../role-permission-editor.jsx';

// Assignment, comments and attachments merged into Tickets: Edit; stage transitions
// moved to board lane capabilities (BoardPermissionEditor).
const TICKET_LABELS = ['Tickets: View', 'Tickets: Create', 'Tickets: Edit', 'Tickets: Delete'];

describe('RolePermissionEditor ticket permissions', () => {
  for (const role of ['read_only', 'developer', 'tester', 'support']) {
    it(`renders editable ticket checkboxes for ${role} in edit mode`, () => {
      render(
        <RolePermissionEditor role={role} snapshot={buildRoleMatrix()} mode="edit" onToggleAction={() => {}} onTogglePermission={() => {}} />,
      );
      for (const label of TICKET_LABELS) {
        const box = screen.getByRole('checkbox', { name: new RegExp(`^${label}\.`) });
        expect(box).toBeEnabled();
      }
    });
  }

  it('toggles a ticket permission through onToggleAction', async () => {
    const onToggleAction = vi.fn();
    render(
      <RolePermissionEditor role="read_only" snapshot={buildRoleMatrix()} mode="edit" onToggleAction={onToggleAction} onTogglePermission={() => {}} />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /^Tickets: Create\./ }));
    expect(onToggleAction).toHaveBeenCalledWith('tickets', 'create', ['tickets.create'], true);
  });
});
