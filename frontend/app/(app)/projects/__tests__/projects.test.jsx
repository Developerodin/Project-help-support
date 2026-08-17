import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectsPage from '../page.jsx';

const listProjects = vi.fn();
const patchProject = vi.fn();
const replaceModules = vi.fn();
const replaceProjectTeamMembers = vi.fn();
const listTeams = vi.fn();

vi.mock('@/shared/api/projects.js', () => ({
  listProjects: (...a) => listProjects(...a),
  patchProject: (...a) => patchProject(...a),
  replaceModules: (...a) => replaceModules(...a),
  replaceProjectTeamMembers: (...a) => replaceProjectTeamMembers(...a),
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

const sampleProjects = [
  {
    id: 'p1',
    brand: 'Dharwin',
    key: 'WEB',
    name: 'Web App',
    status: 'active',
    modules: [],
    team: null,
    teamMembers: [],
  },
  {
    id: 'p2',
    brand: 'Dharwin',
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
    listProjects.mockReset().mockResolvedValue({ results: sampleProjects, totalResults: 2 });
    patchProject.mockReset().mockResolvedValue({});
    replaceModules.mockReset().mockResolvedValue({});
    listTeams.mockReset().mockResolvedValue({ results: [] });
  });

  it('groups project cards under brand sections', async () => {
    render(<ProjectsPage />);

    expect(await screen.findByRole('button', { name: /collapse dharwin/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /WEB — Web App/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /MOB — Mobile App/i })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Project team', level: 5 })).toHaveLength(2);
    expect(screen.getAllByText('Module catalog')).toHaveLength(2);
  });

  it('links to the new project page from the page header', async () => {
    render(<ProjectsPage />);
    await screen.findByRole('button', { name: /collapse dharwin/i });

    const link = screen.getByRole('link', { name: /new project/i });
    expect(link).toHaveAttribute('href', '/projects/new');
  });

  it('collapses and expands a brand section', async () => {
    render(<ProjectsPage />);
    const brandToggle = await screen.findByRole('button', { name: /collapse dharwin/i });
    const brandSection = brandToggle.closest('section');

    expect(brandSection).not.toHaveClass('collapsed');
    expect(brandToggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(brandToggle);

    expect(brandSection).toHaveClass('collapsed');
    expect(screen.getByRole('button', { name: /expand dharwin/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('collapses and expands a project card', async () => {
    render(<ProjectsPage />);
    const webHeading = await screen.findByRole('heading', { name: /WEB — Web App/i });
    const webSection = webHeading.closest('section');
    const toggle = screen.getByRole('button', { name: /collapse web app/i });

    expect(webSection).not.toHaveClass('collapsed');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveClass('project-panel-head-toggle');

    await userEvent.click(toggle);

    expect(webSection).toHaveClass('collapsed');
    expect(screen.getByRole('button', { name: /expand web app/i })).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(screen.getByRole('button', { name: /expand web app/i }));
    expect(webSection).not.toHaveClass('collapsed');
    expect(screen.getByRole('button', { name: /collapse web app/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses a project card when clicking the full header row', async () => {
    render(<ProjectsPage />);
    const mobToggle = await screen.findByRole('button', { name: /collapse mobile app/i });
    const mobSection = mobToggle.closest('section');

    expect(mobSection).not.toHaveClass('collapsed');

    await userEvent.click(within(mobToggle).getByText('active'));

    expect(mobSection).toHaveClass('collapsed');
    expect(screen.getByRole('button', { name: /expand mobile app/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows empty state with link to create a project', async () => {
    listProjects.mockResolvedValue({ results: [], totalResults: 0 });
    render(<ProjectsPage />);

    expect(await screen.findByRole('heading', { name: /no projects yet/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /new project/i })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /new project/i })[1]).toHaveAttribute('href', '/projects/new');
  });
});
