import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectsPage from '../page.jsx';

const listClients = vi.fn();
const patchClient = vi.fn();
const listProjects = vi.fn();
const patchProject = vi.fn();
const replaceModules = vi.fn();
const getProjectClientTesters = vi.fn();
const replaceProjectClientTesters = vi.fn();
const listTeams = vi.fn();
const listUsers = vi.fn();
const showToast = vi.fn();

const authState = {
  user: { _id: 'u-admin', id: 'u-admin', role: 'admin' },
  loading: false,
};

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => authState,
}));

vi.mock('@/shared/api/clients.js', () => ({
  listClients: (...a) => listClients(...a),
  patchClient: (...a) => patchClient(...a),
}));

vi.mock('@/shared/api/projects.js', () => ({
  listProjects: (...a) => listProjects(...a),
  patchProject: (...a) => patchProject(...a),
  replaceModules: (...a) => replaceModules(...a),
  getProjectClientTesters: (...a) => getProjectClientTesters(...a),
  replaceProjectClientTesters: (...a) => replaceProjectClientTesters(...a),
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

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

const sampleCompany = {
  id: 'c1',
  name: 'Dharwin',
  status: 'active',
  projectCount: 2,
};

const sampleProjects = [
  {
    id: 'p1',
    client: sampleCompany,
    key: 'WEB',
    name: 'Web App',
    status: 'active',
    modules: [],
    team: null,
    teamMembers: [],
  },
  {
    id: 'p2',
    client: sampleCompany,
    key: 'MOB',
    name: 'Mobile App',
    status: 'active',
    modules: [],
    team: null,
    teamMembers: [],
  },
];

describe('ProjectsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    authState.user = { _id: 'u-admin', id: 'u-admin', role: 'admin' };
    authState.loading = false;
    listClients.mockReset().mockResolvedValue({ results: [sampleCompany], totalResults: 1 });
    listProjects.mockReset().mockResolvedValue({ results: sampleProjects, totalResults: 2 });
    patchClient.mockReset().mockResolvedValue({ ...sampleCompany, status: 'archived' });
    patchProject.mockReset().mockResolvedValue({});
    replaceModules.mockReset().mockResolvedValue({});
    getProjectClientTesters.mockReset().mockResolvedValue({ projectId: 'p1', clientId: 'c1', items: [] });
    replaceProjectClientTesters.mockReset().mockResolvedValue({ projectId: 'p1', clientId: 'c1', items: [] });
    listTeams.mockReset().mockResolvedValue({ results: [] });
    listUsers.mockReset().mockResolvedValue({ results: [], totalResults: 0 });
    showToast.mockReset();
  });

  it('groups project cards under company sections', async () => {
    render(<ProjectsPage />);

    expect(await screen.findByRole('button', { name: /collapse dharwin/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /WEB — Web App/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /MOB — Mobile App/i })).toBeInTheDocument();
    // Team, client tester and module configuration moved to the project edit page.
    const webSection = screen.getByRole('heading', { name: /WEB — Web App/i }).closest('section');
    const mobSection = screen.getByRole('heading', { name: /MOB — Mobile App/i }).closest('section');
    expect(within(webSection).getByRole('link', { name: /^edit$/i })).toHaveAttribute(
      'href',
      '/projects/p1/edit?return=%2Fprojects',
    );
    expect(within(mobSection).getByRole('link', { name: /^edit$/i })).toHaveAttribute(
      'href',
      '/projects/p2/edit?return=%2Fprojects',
    );
  });

  it('shows new company button in the page header', async () => {
    render(<ProjectsPage />);
    await screen.findByRole('button', { name: /collapse dharwin/i });

    expect(screen.getByRole('button', { name: /new company/i })).toBeInTheDocument();
  });

  it('links add project to new project page with company id', async () => {
    render(<ProjectsPage />);
    await screen.findByRole('button', { name: /collapse dharwin/i });

    const link = screen.getAllByRole('link', { name: /add project/i })[0];
    expect(link).toHaveAttribute(
      'href',
      '/projects/new?clientId=c1&return=%2Fprojects',
    );
  });

  it('collapses and expands a company section', async () => {
    render(<ProjectsPage />);
    const companyToggle = await screen.findByRole('button', { name: /collapse dharwin/i });
    const companySection = companyToggle.closest('section');

    expect(companySection).not.toHaveClass('collapsed');
    expect(companyToggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(companyToggle);

    expect(companySection).toHaveClass('collapsed');
    expect(screen.getByRole('button', { name: /expand dharwin/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders project cards as static summaries without a collapse toggle', async () => {
    render(<ProjectsPage />);
    const webHeading = await screen.findByRole('heading', { name: /WEB — Web App/i });
    const webSection = webHeading.closest('section');

    expect(webSection).not.toHaveClass('collapsed');
    expect(screen.queryByRole('button', { name: /collapse web app/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expand web app/i })).not.toBeInTheDocument();
    expect(within(webSection).getByText('active')).toBeInTheDocument();
  });

  it('shows empty state when no companies exist', async () => {
    listClients.mockResolvedValue({ results: [], totalResults: 0 });
    listProjects.mockResolvedValue({ results: [], totalResults: 0 });
    render(<ProjectsPage />);

    expect(await screen.findByRole('heading', { name: /no companies yet/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new company/i }).length).toBeGreaterThan(0);
  });

  it('archives a company after confirmation', async () => {
    render(<ProjectsPage />);
    const companyToggle = await screen.findByRole('button', { name: /collapse dharwin/i });
    const companyHead = companyToggle.closest('header');

    await userEvent.click(within(companyHead).getByRole('button', { name: /^archive dharwin$/i }));
    expect(screen.getByRole('alertdialog', { name: /archive dharwin/i })).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^archive$/i }));

    await waitFor(() => {
      expect(patchClient).toHaveBeenCalledWith('c1', { status: 'archived' });
    });
    expect(showToast).toHaveBeenCalledWith('Dharwin archived');
  });

  it('archives a project after confirmation', async () => {
    render(<ProjectsPage />);
    await screen.findByRole('button', { name: /collapse dharwin/i });

    const webSection = screen.getByRole('heading', { name: /WEB — Web App/i }).closest('section');
    await userEvent.click(within(webSection).getByRole('button', { name: /^archive web$/i }));
    expect(screen.getByRole('alertdialog', { name: /archive web — web app/i })).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^archive$/i }));

    await waitFor(() => {
      expect(patchProject).toHaveBeenCalledWith('p1', { status: 'archived' });
    });
    expect(showToast).toHaveBeenCalledWith('WEB archived');
  });

  it('keeps a search that arrives in the URL (assistant, back/forward) instead of wiping it', async () => {
    render(<ProjectsPage />);
    await screen.findByRole('button', { name: /collapse dharwin/i });

    window.history.pushState(null, '', '/projects?search=WEB');
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    await new Promise((resolve) => { setTimeout(resolve, 450); }); // past the search debounce
    expect(window.location.search).toContain('search=WEB');
    window.history.pushState(null, '', '/');
  });
});
