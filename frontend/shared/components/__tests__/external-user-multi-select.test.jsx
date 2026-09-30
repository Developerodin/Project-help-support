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

  it('closes dropdown after selecting a user from the list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ExternalUserMultiSelect
        label="Client users"
        users={users}
        selectedIds={[]}
        onChange={onChange}
      />,
    );

    const combobox = screen.getByRole('combobox', { name: /client users/i });
    await user.click(combobox);
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /ada lovelace/i }));
    expect(onChange).toHaveBeenCalledWith(['u1']);
    expect(combobox).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combobox).toHaveValue('');
  });

  it('closes dropdown after deselecting a user from the list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ExternalUserMultiSelect
        label="Client testers"
        users={users}
        selectedIds={['u1']}
        onChange={onChange}
      />,
    );

    const combobox = screen.getByRole('combobox', { name: /client testers/i });
    await user.click(combobox);
    await user.type(combobox, 'ada');
    expect(combobox).toHaveValue('ada');

    await user.click(screen.getByRole('option', { name: /ada lovelace/i }));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(combobox).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combobox).toHaveValue('');
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

  it('renders search with icon in a dedicated flex slot inside .page context', () => {
    const { container } = render(
      <div className="page">
        <ExternalUserMultiSelect
          label="Client users"
          users={users}
          selectedIds={[]}
          onChange={vi.fn()}
        />
      </div>,
    );

    const input = screen.getByRole('combobox', { name: /client users/i });
    const searchWrap = container.querySelector('.external-user-ms__search');
    const iconSlot = searchWrap?.querySelector('.external-user-ms__search-icon');
    const icon = iconSlot?.querySelector('svg');

    expect(icon).toBeTruthy();
    expect(iconSlot).toBeTruthy();
    expect(input).toHaveClass('external-user-ms__input');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'search');
    expect(input).toHaveAttribute('placeholder', 'Search by name or email…');
    expect(searchWrap).toContainElement(iconSlot);
    expect(searchWrap).toContainElement(input);
    expect(iconSlot?.nextElementSibling).toBe(input);
  });

  it('renders search without placeholder overlap inside .dlg context', () => {
    const { container } = render(
      <div className="dlg">
        <div className="dlg-body">
          <ExternalUserMultiSelect
            label="Client testers"
            users={users}
            selectedIds={[]}
            onChange={vi.fn()}
          />
        </div>
      </div>,
    );

    const input = screen.getByRole('combobox', { name: /client testers/i });
    const searchWrap = container.querySelector('.external-user-ms__search');
    const iconSlot = searchWrap?.querySelector('.external-user-ms__search-icon');

    expect(iconSlot).toBeTruthy();
    expect(searchWrap).toContainElement(iconSlot);
    expect(searchWrap).toContainElement(input);
    expect(iconSlot?.nextElementSibling).toBe(input);
    expect(input).not.toHaveStyle({ paddingLeft: '38px' });
  });

  it('hides visible label when hideLabel is set', () => {
    render(
      <ExternalUserMultiSelect
        label="Client tester assign"
        hideLabel
        ariaLabelledBy="tester-heading"
        users={users}
        selectedIds={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Client tester assign')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-labelledby', 'tester-heading');
  });
});
