import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditTeamPage from '../page.jsx';

const push = vi.fn();
const back = vi.fn();
const getTeam = vi.fn();
const patchTeam = vi.fn();
const updateMembers = vi.fn();
const listProjects = vi.fn();
const listUsers = vi.fn();
const showToast = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
  useParams: () => ({ id: 't1' }),
}));

vi.mock('@/shared/api/teams.js', () => ({
  getTeam: (...a) => getTeam(...a),
  patchTeam: (...a) => patchTeam(...a),
  updateMembers: (...a) => updateMembers(...a),
}));

vi.mock('@/shared/api/projects.js', () => ({
  listProjects: (...a) => listProjects(...a),
}));

vi.mock('@/shared/api/users.js', () => ({
  listUsers: (...a) => listUsers(...a),
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: (...a) => showToast(...a),
}));

const ADA = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'developer' };
const GRACE = { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com', role: 'lead' };

const team = (members) => ({
  id: 't1',
  name: 'Platform',
  project: { id: 'p1', key: 'WEB', name: 'Web App' },
  members,
});

describe('EditTeamPage', () => {
  beforeEach(() => {
    push.mockReset();
    back.mockReset();
    getTeam.mockReset().mockResolvedValue(team([ADA]));
    patchTeam.mockReset().mockResolvedValue({ id: 't1', name: 'Platform Ops' });
    updateMembers.mockReset().mockResolvedValue(team([ADA, GRACE]));
    listProjects.mockReset().mockResolvedValue({
      results: [{ id: 'p1', name: 'Web App', key: 'WEB', status: 'active' }],
    });
    listUsers.mockReset().mockResolvedValue({ results: [ADA, GRACE] });
    showToast.mockReset();
  });

  it('prefills the form from the team record', async () => {
    render(<EditTeamPage />);

    expect(await screen.findByDisplayValue('Platform')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /project team/i })).toBeChecked();
    expect(document.getElementById('ntp')).toHaveValue('p1');
    expect(screen.getByRole('heading', { level: 1, name: 'Platform' })).toBeInTheDocument();
  });

  it('lists current members with the count in the overview', async () => {
    render(<EditTeamPage />);
    await screen.findByDisplayValue('Platform');

    expect(screen.getByText('1 member')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();

    const overview = within(screen.getByRole('complementary', { name: /team setup notes/i }));
    expect(overview.getByRole('heading', { name: /team overview/i })).toBeInTheDocument();
    expect(overview.getByText('Project team')).toBeInTheDocument();
    expect(overview.getByText('Web App')).toBeInTheDocument();
  });

  it('hides existing members from the picker and adds the selected ones', async () => {
    const user = userEvent.setup();
    render(<EditTeamPage />);
    await screen.findByDisplayValue('Platform');

    await user.click(screen.getByRole('button', { name: /add members/i }));
    const picker = within(screen.getByRole('listbox', { name: /select members to add/i }));
    expect(picker.queryByRole('checkbox', { name: /ada lovelace/i })).not.toBeInTheDocument();

    await user.click(picker.getByRole('checkbox', { name: /grace hopper/i }));
    await user.click(picker.getByRole('button', { name: /^add members$/i }));

    await waitFor(() => expect(updateMembers).toHaveBeenCalledWith('t1', { add: ['u2'] }));
    expect(await screen.findByText('2 members')).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith('Member added');
    expect(getTeam).toHaveBeenCalledTimes(1);
  });

  it('confirms before removing a member and keeps the account intact', async () => {
    const user = userEvent.setup();
    updateMembers.mockResolvedValue(team([]));
    render(<EditTeamPage />);
    await screen.findByDisplayValue('Platform');

    await user.click(screen.getByRole('button', { name: /remove ada lovelace/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /remove ada lovelace\?/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove member/i }));

    await waitFor(() => expect(updateMembers).toHaveBeenCalledWith('t1', { remove: ['u1'] }));
    expect(await screen.findByText(/no members added yet/i)).toBeInTheDocument();
  });

  it('cancelling the removal confirmation leaves the member in place', async () => {
    const user = userEvent.setup();
    render(<EditTeamPage />);
    await screen.findByDisplayValue('Platform');

    await user.click(screen.getByRole('button', { name: /remove ada lovelace/i }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /^cancel$/i }));

    expect(updateMembers).not.toHaveBeenCalled();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('rolls back and offers a retry when adding members fails', async () => {
    const user = userEvent.setup();
    updateMembers.mockRejectedValueOnce(new Error('nope'));
    render(<EditTeamPage />);
    await screen.findByDisplayValue('Platform');

    await user.click(screen.getByRole('button', { name: /add members/i }));
    const picker = within(screen.getByRole('listbox', { name: /select members to add/i }));
    await user.click(picker.getByRole('checkbox', { name: /grace hopper/i }));
    await user.click(picker.getByRole('button', { name: /^add members$/i }));

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText('1 member')).toBeInTheDocument();

    updateMembers.mockResolvedValue(team([ADA, GRACE]));
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByText('2 members')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('patches the team and redirects to teams', async () => {
    const user = userEvent.setup();
    render(<EditTeamPage />);
    await screen.findByDisplayValue('Platform');

    await user.clear(document.getElementById('ntn'));
    await user.type(document.getElementById('ntn'), 'Platform Ops');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(patchTeam).toHaveBeenCalledWith('t1', { name: 'Platform Ops', project: 'p1' }));
    expect(showToast).toHaveBeenCalledWith('Team updated');
    expect(push).toHaveBeenCalledWith('/teams');
  });

  it('switching to global scope clears the project on save', async () => {
    const user = userEvent.setup();
    render(<EditTeamPage />);
    await screen.findByDisplayValue('Platform');

    await user.click(screen.getByRole('radio', { name: /global team/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(patchTeam).toHaveBeenCalledWith('t1', { name: 'Platform', project: null }));
  });
});
