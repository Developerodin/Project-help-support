import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewProjectPage from '../page.jsx';

const push = vi.fn();
const back = vi.fn();
const createProject = vi.fn();
const listClients = vi.fn();
const listTeams = vi.fn();
const showToast = vi.fn();
let searchParams = new URLSearchParams('clientId=c1');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/shared/api/projects.js', () => ({
  createProject: (...a) => createProject(...a),
}));

vi.mock('@/shared/api/clients.js', () => ({
  listClients: (...a) => listClients(...a),
}));

vi.mock('@/shared/api/teams.js', () => ({
  listTeams: (...a) => listTeams(...a),
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: (...a) => showToast(...a),
}));

const sampleCompany = { id: 'c1', name: 'Dharwin', status: 'active' };

describe('NewProjectPage', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams('clientId=c1');
    push.mockReset();
    back.mockReset();
    createProject.mockReset().mockResolvedValue({ id: 'p3', key: 'OPS', name: 'Operations', client: sampleCompany });
    listClients.mockReset().mockResolvedValue({ results: [sampleCompany] });
    listTeams.mockReset().mockResolvedValue({ results: [{ id: 't1', name: 'Platform' }] });
    showToast.mockReset();
  });

  it('renders the form layout with sidebar notes', async () => {
    render(<NewProjectPage />);

    expect(screen.getByRole('heading', { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /project setup notes/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /company vs project/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /ticket ids/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /project team and modules/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /project team/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /module catalog/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/ticket key/i)).not.toBeInTheDocument();
  });

  it('preselects company from query param', async () => {
    render(<NewProjectPage />);
    await waitFor(() => expect(listClients).toHaveBeenCalled());
    expect(screen.getAllByText('Dharwin').length).toBeGreaterThan(0);
  });

  it('shows validation dialog when project name is empty', async () => {
    const user = userEvent.setup();
    render(<NewProjectPage />);

    await user.click(screen.getByRole('button', { name: /create project/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /fill in required fields/i })).toBeInTheDocument();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Project');
    expect(createProject).not.toHaveBeenCalled();
  });

  it('submits the create payload and redirects to projects', async () => {
    const user = userEvent.setup();
    render(<NewProjectPage />);

    await user.type(document.getElementById('npn'), 'Operations');
    await user.type(document.getElementById('npd'), 'Ops backlog');
    await user.selectOptions(document.getElementById('npdteam'), 't1');
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith({
      clientId: 'c1',
      name: 'Operations',
      description: 'Ops backlog',
      team: 't1',
      modules: [],
    }));
    expect(showToast).toHaveBeenCalledWith('Project OPS created');
    expect(push).toHaveBeenCalledWith('/projects');
  });

  it('navigates back when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<NewProjectPage />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(back).toHaveBeenCalled();
  });
});
