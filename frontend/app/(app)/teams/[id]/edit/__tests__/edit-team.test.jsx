import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditTeamPage from '../page.jsx';

const push = vi.fn();
const back = vi.fn();
const getTeam = vi.fn();
const patchTeam = vi.fn();
const listProjects = vi.fn();
const showToast = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
  useParams: () => ({ id: 't1' }),
}));

vi.mock('@/shared/api/teams.js', () => ({
  getTeam: (...a) => getTeam(...a),
  patchTeam: (...a) => patchTeam(...a),
}));

vi.mock('@/shared/api/projects.js', () => ({
  listProjects: (...a) => listProjects(...a),
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: (...a) => showToast(...a),
}));

describe('EditTeamPage', () => {
  beforeEach(() => {
    push.mockReset();
    back.mockReset();
    getTeam.mockReset().mockResolvedValue({
      id: 't1',
      name: 'Platform',
      project: { id: 'p1', key: 'WEB', name: 'Web App' },
      members: [],
    });
    patchTeam.mockReset().mockResolvedValue({ id: 't1', name: 'Platform Ops' });
    listProjects.mockReset().mockResolvedValue({
      results: [{ id: 'p1', name: 'Web App', key: 'WEB', status: 'active' }],
    });
    showToast.mockReset();
  });

  it('prefills the form from the team record', async () => {
    render(<EditTeamPage />);

    expect(await screen.findByDisplayValue('Platform')).toBeInTheDocument();
    expect(document.getElementById('ntp')).toHaveValue('p1');
    expect(screen.getByRole('heading', { name: /edit team/i })).toBeInTheDocument();
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
});
