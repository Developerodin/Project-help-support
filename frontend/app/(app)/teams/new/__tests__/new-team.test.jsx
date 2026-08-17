import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewTeamPage from '../page.jsx';

const push = vi.fn();
const back = vi.fn();
const createTeam = vi.fn();
const listProjects = vi.fn();
const listUsers = vi.fn();
const showToast = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
}));

vi.mock('@/shared/api/teams.js', () => ({
  createTeam: (...a) => createTeam(...a),
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

const openPicker = async (user) => {
  await user.click(screen.getByRole('button', { name: /add members/i }));
  return within(screen.getByRole('listbox', { name: /select members to add/i }));
};

describe('NewTeamPage', () => {
  beforeEach(() => {
    push.mockReset();
    back.mockReset();
    createTeam.mockReset().mockResolvedValue({ id: 't2', name: 'Platform' });
    listProjects.mockReset().mockResolvedValue({
      results: [{ id: 'p1', name: 'Web App', key: 'WEB', status: 'active' }],
    });
    listUsers.mockReset().mockResolvedValue({
      results: [
        { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'developer' },
        { id: 'u2', name: 'Grace Hopper', email: 'grace@example.com', role: 'lead' },
      ],
    });
    showToast.mockReset();
  });

  it('renders the form layout with the context panel', async () => {
    render(<NewTeamPage />);

    expect(screen.getByRole('heading', { name: /create a team/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create team/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /team setup notes/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /about teams/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: /global team/i })).toBeChecked();
    expect(screen.getByText(/no members added yet/i)).toBeInTheDocument();
  });

  it('shows validation dialog when team name is empty', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);

    await user.click(screen.getByRole('button', { name: /create team/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /fill in required fields/i })).toBeInTheDocument();
    expect(createTeam).not.toHaveBeenCalled();
  });

  it('only reveals the project picker for a project-scoped team', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);

    expect(screen.queryByLabelText(/^project$/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /project team/i }));
    expect(await screen.findByLabelText(/^project$/i)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /global team/i }));
    expect(screen.queryByLabelText(/^project$/i)).not.toBeInTheDocument();
  });

  it('requires a project when project scope is selected', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);

    await user.type(document.getElementById('ntn'), 'Platform');
    await user.click(screen.getByRole('radio', { name: /project team/i }));
    await user.click(screen.getByRole('button', { name: /create team/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(createTeam).not.toHaveBeenCalled();
  });

  it('creates a global team with no members', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);

    await user.type(document.getElementById('ntn'), 'Platform');
    await user.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(createTeam)
      .toHaveBeenCalledWith({ name: 'Platform', project: null, members: [] }));
  });

  it('picks members locally and submits them with the team', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);
    await screen.findByRole('button', { name: /add members/i });

    await user.type(document.getElementById('ntn'), 'Platform');
    const picker = await openPicker(user);
    await user.click(picker.getByRole('checkbox', { name: /ada lovelace/i }));
    await user.click(picker.getByRole('checkbox', { name: /grace hopper/i }));
    await user.click(picker.getByRole('button', { name: /^add members$/i }));

    expect(await screen.findByText('2 members')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(createTeam).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /create team/i }));
    await waitFor(() => expect(createTeam)
      .toHaveBeenCalledWith({ name: 'Platform', project: null, members: ['u1', 'u2'] }));
  });

  it('filters the picker by name or email and keeps selections while searching', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);
    await screen.findByRole('button', { name: /add members/i });

    const picker = await openPicker(user);
    await user.click(picker.getByRole('checkbox', { name: /ada lovelace/i }));
    await user.type(picker.getByRole('searchbox', { name: /search people/i }), 'grace@');

    expect(picker.queryByRole('checkbox', { name: /ada lovelace/i })).not.toBeInTheDocument();
    expect(picker.getByRole('checkbox', { name: /grace hopper/i })).toBeInTheDocument();
    // Ada stays picked, and her chip stays visible, even though the list filtered her out.
    expect(picker.getByText('1 selected')).toBeInTheDocument();
    expect(picker.getByRole('button', { name: /deselect ada lovelace/i })).toBeInTheDocument();
  });

  it('shows an empty result state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);
    await screen.findByRole('button', { name: /add members/i });

    const picker = await openPicker(user);
    await user.type(picker.getByRole('searchbox', { name: /search people/i }), 'zzz');

    expect(picker.getByText(/no people found/i)).toBeInTheDocument();
  });

  it('removes a picked member without calling the API and hides them from the picker', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);
    await screen.findByRole('button', { name: /add members/i });

    let picker = await openPicker(user);
    await user.click(picker.getByRole('checkbox', { name: /ada lovelace/i }));
    await user.click(picker.getByRole('button', { name: /^add members$/i }));
    expect(await screen.findByText('1 member')).toBeInTheDocument();

    // Already picked, so she is gone from the available list — no duplicates.
    picker = await openPicker(user);
    expect(picker.queryByRole('checkbox', { name: /ada lovelace/i })).not.toBeInTheDocument();
    await user.click(picker.getByRole('button', { name: /^cancel$/i }));

    await user.click(screen.getByRole('button', { name: /remove ada lovelace/i }));
    expect(screen.getByText(/no members added yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('submits the create payload and redirects to teams', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);

    await user.type(document.getElementById('ntn'), 'Platform');
    await user.click(screen.getByRole('radio', { name: /project team/i }));
    await user.selectOptions(await screen.findByLabelText(/^project$/i), 'p1');
    await user.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(createTeam)
      .toHaveBeenCalledWith({ name: 'Platform', project: 'p1', members: [] }));
    expect(showToast).toHaveBeenCalledWith('Team created');
    expect(push).toHaveBeenCalledWith('/teams');
  });

  it('navigates back when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(back).toHaveBeenCalled();
  });
});
