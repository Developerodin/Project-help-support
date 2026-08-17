import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectsPage from '../page.jsx';

const listClients = vi.fn();
const listProjects = vi.fn();
const patchProject = vi.fn();
const replaceModules = vi.fn();
const listTeams = vi.fn();

vi.mock('@/shared/api/clients.js', () => ({
  listClients: (...a) => listClients(...a),
}));

vi.mock('@/shared/api/projects.js', () => ({
  listProjects: (...a) => listProjects(...a),
  patchProject: (...a) => patchProject(...a),
  replaceModules: (...a) => replaceModules(...a),
}));

vi.mock('@/shared/api/teams.js', () => ({
  listTeams: (...a) => listTeams(...a),
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: vi.fn(),
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
    listClients.mockReset().mockResolvedValue({ results: [sampleCompany], totalResults: 1 });
    listProjects.mockReset().mockResolvedValue({ results: sampleProjects, totalResults: 2 });
    patchProject.mockReset().mockResolvedValue({});
    replaceModules.mockReset().mockResolvedValue({});
    listTeams.mockReset().mockResolvedValue({ results: [] });
  });

  it('groups project cards under company sections', async () => {
    render(<ProjectsPage />);

    expect(await screen.findByRole('button', { name: /collapse dharwin/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /WEB — Web App/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /MOB — Mobile App/i })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Project team', level: 5 })).toHaveLength(2);
    expect(screen.getAllByText('Module catalog')).toHaveLength(2);
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
    expect(link).toHaveAttribute('href', '/projects/new?clientId=c1');
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

  it('collapses and expands a project card', async () => {
    render(<ProjectsPage />);
    const webHeading = await screen.findByRole('heading', { name: /WEB — Web App/i });
    const webSection = webHeading.closest('section');
    const toggle = screen.getByRole('button', { name: /collapse web app/i });

    expect(webSection).not.toHaveClass('collapsed');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(toggle);

    expect(webSection).toHaveClass('collapsed');
    expect(screen.getByRole('button', { name: /expand web app/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows empty state when no companies exist', async () => {
    listClients.mockResolvedValue({ results: [], totalResults: 0 });
    listProjects.mockResolvedValue({ results: [], totalResults: 0 });
    render(<ProjectsPage />);

    expect(await screen.findByRole('heading', { name: /no companies yet/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new company/i }).length).toBeGreaterThan(0);
  });
});
