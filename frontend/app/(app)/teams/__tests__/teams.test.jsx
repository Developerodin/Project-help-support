import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamsPage from '../page.jsx';

const listTeams = vi.fn();
const createTeam = vi.fn();
const updateMembers = vi.fn();
const listProjects = vi.fn();
const listUsers = vi.fn();

vi.mock('@/shared/api/teams.js', () => ({
  listTeams: (...a) => listTeams(...a),
  createTeam: (...a) => createTeam(...a),
  updateMembers: (...a) => updateMembers(...a),
}));

vi.mock('@/shared/api/projects.js', () => ({
  listProjects: (...a) => listProjects(...a),
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
    createTeam.mockReset().mockResolvedValue({ id: 't2' });
    updateMembers.mockReset().mockResolvedValue({});
    listProjects.mockReset().mockResolvedValue({ results: [{ id: 'p1', name: 'Web App', key: 'WEB' }] });
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
    await userEvent.click(within(picker).getByRole('button', { name: /^add 1$/i }));

    await waitFor(() => expect(updateMembers).toHaveBeenCalledWith('t1', { add: ['u2'] }));
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

  it('creates a team with loading state', async () => {
    let resolveCreate;
    createTeam.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));

    render(<TeamsPage />);
    await screen.findByRole('heading', { name: 'Platform' });

    await userEvent.type(screen.getByLabelText(/team name/i), 'New Squad');
    await userEvent.click(screen.getByRole('button', { name: /^create team$/i }));

    expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();
    resolveCreate({ id: 't3' });
    await waitFor(() => expect(createTeam).toHaveBeenCalledWith({ name: 'New Squad', project: null }));
  });
});
