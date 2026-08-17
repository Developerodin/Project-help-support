import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExternalUserMultiSelect from '../external-user-multi-select.jsx';

const users = [
  { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com' },
  { id: 'u3', name: 'Alan Turing', email: 'alan@example.com' },
  { id: 'u4', name: 'Katherine Johnson', email: 'katherine@example.com' },
  { id: 'u5', name: 'Margaret Hamilton', email: 'margaret@example.com' },
];

describe('ExternalUserMultiSelect', () => {
  it('renders compact empty state', () => {
    render(
      <ExternalUserMultiSelect
        label="Client users"
        users={[]}
        selectedIds={[]}
        onChange={vi.fn()}
        emptyMessage="No client users available. Invite users from People."
      />,
    );

    expect(screen.getByText('No client users available. Invite users from People.')).toBeInTheDocument();
  });

  it('shows selected chips and +N more overflow', () => {
    render(
      <ExternalUserMultiSelect
        label="Client testers"
        users={users}
        selectedIds={users.map((user) => user.id)}
        onChange={vi.fn()}
        maxVisibleChips={3}
      />,
    );

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('selects and removes users from the dropdown', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ExternalUserMultiSelect
        label="Client users"
        users={users}
        selectedIds={['u1']}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /remove ada lovelace/i }));
    expect(onChange).toHaveBeenCalledWith([]);

    await user.click(screen.getByRole('combobox', { name: /client users/i }));
    await user.click(screen.getByRole('option', { name: /grace hopper/i }));
    expect(onChange).toHaveBeenLastCalledWith(['u1', 'u2']);
  });
});
