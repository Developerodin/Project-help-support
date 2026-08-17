import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamsPage from '../page.jsx';

const listTeams = vi.fn();
const updateMembers = vi.fn();
const listUsers = vi.fn();

vi.mock('@/shared/api/teams.js', () => ({
  listTeams: (...a) => listTeams(...a),
  updateMembers: (...a) => updateMembers(...a),
}));

vi.mock('@/shared/api/users.js', () => ({
  listUsers: (...a) => listUsers(...a),
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

describe('TeamsPage', () => {
  beforeEach(() => {
    listTeams.mockReset().mockResolvedValue({
      results: [
        {
          id: 't1',
          name: 'Platform',
          project: null,
          members: [{ id: 'u1', name: 'Ada Lovelace' }],
        },
      ],
      totalResults: 1,
    });
    updateMembers.mockReset().mockResolvedValue({});
    listUsers.mockReset().mockResolvedValue({
      results: [
        { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
        { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com' },
      ],
    });
  });

  it('lists teams with member chips instead of comma-separated names', async () => {
    render(<TeamsPage />);

    expect(await screen.findByRole('heading', { name: 'Platform' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace, Grace Hopper')).not.toBeInTheDocument();
  });

  it('shows a New team link in the page header', async () => {
    render(<TeamsPage />);
    await screen.findByRole('heading', { name: 'Platform' });

    const link = screen.getByRole('link', { name: /new team/i });
    expect(link).toHaveAttribute('href', '/teams/new');
  });

  it('shows edit links on team cards', async () => {
    render(<TeamsPage />);
    await screen.findByRole('heading', { name: 'Platform' });

    expect(screen.getByRole('link', { name: /^edit$/i })).toHaveAttribute('href', '/teams/t1/edit');
  });

  it('shows empty member state when a team has no members', async () => {
    listTeams.mockResolvedValue({
      results: [{ id: 't1', name: 'Empty Squad', project: null, members: [] }],
    });

    render(<TeamsPage />);

    expect(await screen.findByText(/add people to route tickets to this team/i)).toBeInTheDocument();
  });

  it('adds multiple members through the picker', async () => {
    render(<TeamsPage />);
    await screen.findByRole('heading', { name: 'Platform' });

    await userEvent.click(screen.getByRole('button', { name: /add members/i }));
    const picker = screen.getByRole('listbox', { name: /select members to add/i });
    await userEvent.click(within(picker).getByRole('checkbox', { name: /grace hopper/i }));
    await userEvent.click(within(picker).getByRole('button', { name: /^add members$/i }));

    await waitFor(() => expect(updateMembers).toHaveBeenCalledWith('t1', { add: ['u2'] }));
  });

  it('summarises the roster and filters cards by scope and search', async () => {
    listTeams.mockResolvedValue({
      results: [
        {
          id: 't1',
          name: 'Platform',
          project: null,
          members: [{ id: 'u1', name: 'Ada Lovelace' }],
          stats: { total: 5, open: 4, overdue: 2 },
        },
        {
          id: 't2',
          name: 'Web Squad',
          project: { id: 'p1', key: 'WEB', name: 'Web App' },
          members: [],
          stats: { total: 1, open: 1, overdue: 0 },
        },
      ],
    });

    render(<TeamsPage />);
    await screen.findByRole('heading', { name: 'Platform' });

    // 2 teams, 1 person on a team, 5 open tickets, 1 of 2 active users unassigned.
    const metrics = screen.getByText('People on a team').closest('dl');
    const tile = (label) => within(metrics).getByText(label).parentElement;
    expect(within(tile('Teams')).getByText('2')).toBeInTheDocument();
    expect(within(tile('People on a team')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Open tickets')).getByText('5')).toBeInTheDocument();
    expect(within(tile('Overdue')).getByText('2')).toBeInTheDocument();
    expect(within(tile('Not on a team')).getByText('1')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/scope/i), 'empty');
    expect(screen.queryByRole('heading', { name: 'Platform' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Web Squad' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/scope/i), 'all');
    await userEvent.type(screen.getByLabelText(/search teams/i), 'ada');
    expect(screen.getByRole('heading', { name: 'Platform' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Web Squad' })).not.toBeInTheDocument();
  });

  it('offers a way out when filters match nothing', async () => {
    render(<TeamsPage />);
    await screen.findByRole('heading', { name: 'Platform' });

    await userEvent.type(screen.getByLabelText(/search teams/i), 'zzz');
    expect(screen.getByRole('heading', { name: /no teams match/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByRole('heading', { name: 'Platform' })).toBeInTheDocument();
  });

  it('removing a member goes through PATCH after confirmation', async () => {
    render(<TeamsPage />);
    await screen.findByText('Ada Lovelace');

    await userEvent.click(screen.getByRole('button', { name: /remove ada lovelace/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(updateMembers).toHaveBeenCalledWith('t1', { remove: ['u1'] }));
  });
});
