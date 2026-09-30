import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectSwitcher from '../project-switcher.jsx';
import { writeStoredProjectId } from '@/shared/lib/active-project.js';
import { ROLE_IDS } from '@pms/shared';

const setActiveProjectId = vi.fn();

const mockUseProject = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: () => mockUseProject(),
}));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('ProjectSwitcher', () => {
  beforeEach(() => {
    setActiveProjectId.mockImplementation((id) => writeStoredProjectId(id));
    window.localStorage.clear();
    mockUseAuth.mockReturnValue({ user: { role: ROLE_IDS.ADMIN } });
    mockUseProject.mockReturnValue({
      projects: [
        { id: 'web-id', key: 'WEB', name: 'Web App', status: 'active' },
        { id: 'mob-id', key: 'MOB', name: 'Mobile App', status: 'active' },
      ],
      loading: false,
      activeProjectId: 'web-id',
      activeProject: { id: 'web-id', key: 'WEB', name: 'Web App', status: 'active' },
      setActiveProjectId,
    });
  });

  it('shows the active project key and name in the top bar control', () => {
    render(<ProjectSwitcher />);
    const trigger = screen.getByRole('button', { name: 'Current project: WEB Web App. Switch project' });
    expect(trigger).toHaveTextContent('WEB');
    expect(trigger).toHaveTextContent('Web App');
  });

  it('calls setActiveProjectId when another project is chosen', async () => {
    const user = userEvent.setup();
    render(<ProjectSwitcher />);
    await user.click(screen.getByRole('button', { name: /Switch project$/ }));
    await user.click(screen.getByRole('menuitem', { name: /Mobile App/ }));
    expect(setActiveProjectId).toHaveBeenCalledWith('mob-id');
    expect(window.localStorage.getItem('pms:activeProjectId')).toBe('mob-id');
  });

  it('hides the switcher for single-project external users', () => {
    mockUseAuth.mockReturnValue({ user: { role: ROLE_IDS.CLIENT_TESTER } });
    mockUseProject.mockReturnValue({
      projects: [{ id: 'web-id', key: 'WEB', name: 'Web App', status: 'active' }],
      loading: false,
      activeProjectId: 'web-id',
      activeProject: { id: 'web-id', key: 'WEB', name: 'Web App', status: 'active' },
      setActiveProjectId,
    });

    render(<ProjectSwitcher />);
    expect(screen.queryByRole('button', { name: /Switch project$/ })).not.toBeInTheDocument();
  });

  it('shows the switcher for multi-project external users', () => {
    mockUseAuth.mockReturnValue({ user: { role: ROLE_IDS.CLIENT_TESTER } });
    mockUseProject.mockReturnValue({
      projects: [
        { id: 'web-id', key: 'WEB', name: 'Web App', status: 'active' },
        { id: 'mob-id', key: 'MOB', name: 'Mobile App', status: 'active' },
      ],
      loading: false,
      activeProjectId: 'web-id',
      activeProject: { id: 'web-id', key: 'WEB', name: 'Web App', status: 'active' },
      setActiveProjectId,
    });

    render(<ProjectSwitcher />);
    expect(screen.getByRole('button', { name: /Switch project$/ })).toBeInTheDocument();
  });
});
