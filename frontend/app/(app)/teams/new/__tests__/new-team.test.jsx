import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewTeamPage from '../page.jsx';

const push = vi.fn();
const back = vi.fn();
const createTeam = vi.fn();
const listProjects = vi.fn();
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

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: (...a) => showToast(...a),
}));

describe('NewTeamPage', () => {
  beforeEach(() => {
    push.mockReset();
    back.mockReset();
    createTeam.mockReset().mockResolvedValue({ id: 't2', name: 'Platform' });
    listProjects.mockReset().mockResolvedValue({
      results: [{ id: 'p1', name: 'Web App', key: 'WEB', status: 'active' }],
    });
    showToast.mockReset();
  });

  it('renders the form layout with sidebar notes', async () => {
    render(<NewTeamPage />);

    expect(screen.getByRole('heading', { name: /new team/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create team/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /team setup notes/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /global vs project teams/i })).toBeInTheDocument();
    expect(await screen.findByLabelText(/project scope/i)).toBeInTheDocument();
  });

  it('shows validation dialog when team name is empty', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);

    await user.click(screen.getByRole('button', { name: /create team/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /fill in required fields/i })).toBeInTheDocument();
    expect(createTeam).not.toHaveBeenCalled();
  });

  it('submits the create payload and redirects to teams', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);

    await user.type(document.getElementById('ntn'), 'Platform');
    await user.selectOptions(document.getElementById('ntp'), 'p1');
    await user.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(createTeam).toHaveBeenCalledWith({ name: 'Platform', project: 'p1' }));
    expect(showToast).toHaveBeenCalledWith('Team created');
    expect(push).toHaveBeenCalledWith('/teams');
  });

  it('navigates back when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<NewTeamPage />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(back).toHaveBeenCalled();
  });
});
