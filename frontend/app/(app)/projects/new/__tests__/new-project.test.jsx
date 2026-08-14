import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewProjectPage from '../page.jsx';

const push = vi.fn();
const back = vi.fn();
const createProject = vi.fn();
const listBrands = vi.fn();
const listUsers = vi.fn();
const listTeams = vi.fn();
const showToast = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
}));

vi.mock('@/shared/api/projects.js', () => ({
  createProject: (...a) => createProject(...a),
  listBrands: (...a) => listBrands(...a),
}));

vi.mock('@/shared/api/users.js', () => ({
  listUsers: (...a) => listUsers(...a),
}));

vi.mock('@/shared/api/teams.js', () => ({
  listTeams: (...a) => listTeams(...a),
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: (...a) => showToast(...a),
}));

describe('NewProjectPage', () => {
  beforeEach(() => {
    push.mockReset();
    back.mockReset();
    createProject.mockReset().mockResolvedValue({ id: 'p3', key: 'OPS', name: 'Operations', brand: 'Acme' });
    listBrands.mockReset().mockResolvedValue(['Dharwin']);
    listUsers.mockReset().mockResolvedValue({ results: [{ id: 'u1', name: 'Alex Dev' }] });
    listTeams.mockReset().mockResolvedValue({ results: [{ id: 't1', name: 'Platform' }] });
    showToast.mockReset();
  });

  it('renders the form layout with sidebar notes', async () => {
    render(<NewProjectPage />);

    expect(screen.getByRole('heading', { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /project setup notes/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /brand vs project/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /ticket ids/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /defaults and modules/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Defaults', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /module catalog/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/ticket key/i)).not.toBeInTheDocument();
  });

  it('shows validation dialog when required fields are empty', async () => {
    const user = userEvent.setup();
    render(<NewProjectPage />);

    await user.click(screen.getByRole('button', { name: /create project/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /fill in required fields/i })).toBeInTheDocument();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Brand');
    expect(dialog).toHaveTextContent('Project');
    expect(createProject).not.toHaveBeenCalled();
  });

  it('focuses the first invalid field after dismissing the validation dialog', async () => {
    const user = userEvent.setup();
    render(<NewProjectPage />);

    await user.click(screen.getByRole('button', { name: /create project/i }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: /got it/i }));

    await waitFor(() => {
      expect(document.getElementById('npb')).toHaveFocus();
    });
  });

  it('submits the create payload and redirects to projects', async () => {
    const user = userEvent.setup();
    render(<NewProjectPage />);

    await user.type(document.getElementById('npb'), 'Acme');
    await user.type(document.getElementById('npn'), 'Operations');
    await user.type(document.getElementById('npd'), 'Ops backlog');
    await user.selectOptions(document.getElementById('npda'), 'u1');
    await user.selectOptions(document.getElementById('npdteam'), 't1');
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith({
      brand: 'Acme',
      name: 'Operations',
      description: 'Ops backlog',
      defaultAssignee: 'u1',
      defaultTester: null,
      defaultTeam: 't1',
      modules: [],
    }));
    expect(showToast).toHaveBeenCalledWith('Project OPS created');
    expect(push).toHaveBeenCalledWith('/projects');
  });

  it('shows loading state while creating', async () => {
    let resolveCreate;
    createProject.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));

    const user = userEvent.setup();
    render(<NewProjectPage />);

    await user.type(document.getElementById('npb'), 'Acme');
    await user.type(document.getElementById('npn'), 'Operations');
    await user.click(screen.getByRole('button', { name: /create project/i }));

    expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();
    resolveCreate({ id: 'p3', key: 'OPS', name: 'Operations' });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects'));
  });

  it('navigates back when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<NewProjectPage />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(back).toHaveBeenCalled();
  });
});
