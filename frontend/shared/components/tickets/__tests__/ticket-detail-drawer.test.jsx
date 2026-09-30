import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketDetailDrawer from '../ticket-detail-drawer.jsx';

const getTicket = vi.fn();
const transitionTicket = vi.fn();
const patchTicket = vi.fn();
const uploadAttachments = vi.fn();
const assignTicket = vi.fn();
const listTeams = vi.fn();
const getProject = vi.fn();
const showToast = vi.fn();

const authState = {
  user: { _id: 'u-admin', id: 'u-admin', role: 'admin' },
};

vi.mock('@/shared/api/tickets.js', () => ({
  getTicket: (...args) => getTicket(...args),
  transitionTicket: (...args) => transitionTicket(...args),
  patchTicket: (...args) => patchTicket(...args),
  assignTicket: (...args) => assignTicket(...args),
  addComment: vi.fn(),
  uploadAttachments: (...args) => uploadAttachments(...args),
  attachmentDownloadUrl: () => '/x',
  resolveAttachmentDownloadUrl: vi.fn().mockResolvedValue('https://example.com/shot.png'),
  watchTicket: vi.fn(),
  unwatchTicket: vi.fn(),
  setBlocked: vi.fn(),
  clearBlocked: vi.fn(),
  deleteTicket: vi.fn(),
  markDiscussionRead: vi.fn().mockResolvedValue({ lastReadAt: new Date().toISOString() }),
}));
vi.mock('@/shared/api/notifications.js', () => ({
  getTicketNotificationSettings: vi.fn().mockResolvedValue({
    muted: false, following: false, canFollow: true, inAudienceByRole: false,
  }),
  updateTicketNotificationSettings: vi.fn(),
}));
vi.mock('@/shared/api/teams.js', () => ({
  listTeams: (...args) => listTeams(...args),
}));
vi.mock('@/shared/api/projects.js', () => ({
  getProject: (...args) => getProject(...args),
}));
vi.mock('@/shared/lib/toast.js', () => ({
  showToast: (...args) => showToast(...args),
}));
vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({ user: authState.user }),
}));
vi.mock('@/shared/hooks/use-permission-context.js', () => ({
  usePermissionContext: () => ({
    permissionContext: { roleMatrix: null, userOverrides: {}, loadFailed: false },
    loading: false,
  }),
}));
vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: () => ({
    activeProjectId: 'p1',
    setActiveProjectId: vi.fn(),
  }),
}));

const ticket = {
  id: 't1', ticketId: 'WEB-101', title: 'Broken login', description: 'Nothing happens',
  status: 'pending', revision: 3, createdBy: { id: 'u-admin', name: 'Root' },
  project: { id: 'p1', key: 'WEB', name: 'Web App' },
  comments: [], attachments: [], stageHistory: [], activityLog: [], labels: [],
  createdAt: '2026-08-01T00:00:00.000Z',
};

const projectTeamFixture = {
  team: { id: 'team-1', name: 'Platform' },
  teamMembers: [{
    user: { id: 'u-dev', name: 'Dev User', email: 'dev@example.com' },
    role: 'developer',
    roleLabel: 'Developer',
  }],
};

const projectWithoutTeamFixture = {
  team: null,
  teamMembers: [],
};

let mockUser = authState.user;

describe('TicketDetailDrawer', () => {
  beforeEach(() => {
    authState.user = { _id: 'u-admin', id: 'u-admin', role: 'admin' };
    mockUser = authState.user;
    getTicket.mockReset().mockResolvedValue(ticket);
    transitionTicket.mockReset()
      .mockResolvedValue({ ...ticket, status: 'under_review', revision: 4 });
    patchTicket.mockReset().mockResolvedValue(ticket);
    uploadAttachments.mockReset().mockResolvedValue([]);
    assignTicket.mockReset().mockResolvedValue({ ...ticket, team: { id: 'team-1', name: 'Platform' }, revision: 4 });
    listTeams.mockReset().mockResolvedValue({
      results: [{ id: 'team-1', _id: 'team-1', name: 'Platform', project: { key: 'WEB' } }],
    });
    getProject.mockReset().mockResolvedValue(projectTeamFixture);
    showToast.mockReset();
  });

  it('renders the stage strip as read-only and shows standing context on every tab', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    // The strip is clickable for legal moves; the current stage itself is inert.
    const current = document.querySelector('.railboard [aria-current="step"]');
    expect(current).toHaveTextContent('Pending');
    expect(within(current).getByRole('button')).toBeDisabled();
    expect(screen.getByRole('list', { name: /stage pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to under review/i })).toBeInTheDocument();

    expect(screen.getByText(/you can't set this/i)).toBeInTheDocument();

    const strip = screen.getByRole('group', { name: /ticket context/i });
    expect(within(strip).getByText(/unassigned/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /history/i }));
    expect(screen.getByRole('group', { name: /ticket context/i })).toBeInTheDocument();
  });

  it('puts the tab bar in the fixed header, outside the scrolling panel', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    const tablist = screen.getByRole('tablist', { name: /ticket detail/i });
    const head = document.querySelector('.drawer-head');
    const body = document.querySelector('.drawer-body');

    expect(head).toBeTruthy();
    expect(body).toBeTruthy();
    expect(head.contains(tablist)).toBe(true);
    expect(body.contains(tablist)).toBe(false);
  });

  it('loads the ticket by its human id and shows the three-section drawer layout', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);

    await waitFor(() => expect(getTicket).toHaveBeenCalledWith(
      'WEB-101', expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(await screen.findByText('WEB-101')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stage', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /discussion/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^details$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /history/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attach/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/add a comment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to under review/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));
    expect(screen.getByRole('heading', { name: 'Details', hidden: true })).toBeInTheDocument();
    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    expect(within(rail).getAllByText(/resolution estimate/i).length).toBeGreaterThan(0);
    expect(document.getElementById('panel-details').contains(rail)).toBe(true);

    await userEvent.click(screen.getByRole('tab', { name: /history/i }));
    expect(screen.getByText(/no activity to show/i)).toBeInTheDocument();
  });

  it('keeps metadata rail out of the discussion tab and shows it on details', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    const discussion = document.getElementById('panel-discussion');
    expect(discussion).toBeTruthy();
    const discussionScope = within(discussion);

    expect(discussionScope.queryByText('Resolution estimate')).not.toBeInTheDocument();
    expect(discussionScope.queryByText('Expected release')).not.toBeInTheDocument();
    expect(discussionScope.queryByText('In current stage')).not.toBeInTheDocument();
    expect(discussionScope.getByRole('button', { name: /^attach/i })).toBeInTheDocument();
    expect(discussionScope.getByLabelText(/add a comment/i)).toBeInTheDocument();

    expect(screen.queryByRole('complementary', { name: /ticket metadata/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));
    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    expect(within(rail).getAllByText(/resolution estimate/i).length).toBeGreaterThan(0);
    expect(within(rail).getByText(/assignee/i)).toBeInTheDocument();
  });

  it('does not render assignee twice when the rail is present', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');
    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));

    const panel = document.getElementById('panel-details');
    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });

    expect(screen.getAllByLabelText(/assignee/i)).toHaveLength(1);
    expect(within(rail).getByText('Assignee')).toBeInTheDocument();

    const fields = panel.querySelector('.detail-fields');
    expect(within(fields).queryByText('Assignee')).not.toBeInTheDocument();
    expect(within(fields).queryByText('Reporter')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimates')).not.toBeInTheDocument();
  });

  it('marks the drawer as a modal dialog and moves focus into it', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/WEB-101/);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('does not close the drawer when Escape dismisses a nested dialog', async () => {
    const onClose = vi.fn();
    transitionTicket.mockRejectedValueOnce({
      status: 400,
      code: 'ESTIMATES_REQUIRED',
      message: 'Dates required',
      fields: { estimatedResolutionAt: 'Required', expectedReleaseDate: 'Required' },
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={onClose} onChanged={() => {}} />);
    await screen.findByText('WEB-101');
    await userEvent.click(screen.getByRole('button', { name: /move to under review/i }));
    await screen.findByRole('alertdialog');

    await userEvent.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape when no nested dialog is open', async () => {
    const onClose = vi.fn();
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={onClose} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens on the tab the URL names, and keeps the URL in step as tabs change', async () => {
    window.history.replaceState(null, '', '/tickets?ticket=WEB-101&tab=history');
    try {
      render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
      await screen.findByText('WEB-101');
      await waitFor(() => expect(screen.getByRole('tab', { name: /history/i })).toHaveAttribute('aria-selected', 'true'));

      await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));
      expect(new URLSearchParams(window.location.search).get('tab')).toBe('details');
      await userEvent.click(screen.getByRole('tab', { name: /discussion/i }));
      expect(new URLSearchParams(window.location.search).has('tab')).toBe(false);
      expect(new URLSearchParams(window.location.search).get('ticket')).toBe('WEB-101');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('moves between tabs with arrow keys and keeps only the active tab tabbable', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    const discussion = screen.getByRole('tab', { name: /discussion/i });
    const details = screen.getByRole('tab', { name: /^details$/i });

    expect(discussion).toHaveAttribute('tabindex', '0');
    expect(details).toHaveAttribute('tabindex', '-1');

    discussion.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(details).toHaveAttribute('aria-selected', 'true');
    expect(details).toHaveAttribute('tabindex', '0');
  });

  it('closing calls back — it does not navigate', async () => {
    const onClose = vi.fn();
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={onClose} onChanged={() => {}} />);

    await screen.findByText('WEB-101');
    await userEvent.click(screen.getByRole('button', { name: /close ticket/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('sends the loaded revision with a transition', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('button', { name: /move to under review/i }));

    await waitFor(() => expect(transitionTicket).toHaveBeenCalledWith(
      'WEB-101', { to: 'under_review', revision: 3 },
    ));
  });

  it('keeps the drawer on screen while a transition refetch is in flight', async () => {
    let resolveRefetch;
    getTicket
      .mockResolvedValueOnce(ticket)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefetch = resolve; }));

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('button', { name: /move to under review/i }));
    await waitFor(() => expect(getTicket).toHaveBeenCalledTimes(2));

    // Blanking the ticket mid-refetch drops `.on`, which slides the drawer out
    // and back in again on every status change.
    expect(document.querySelector('.ticket-drawer').className).toContain('on');
    expect(screen.getByText('WEB-101')).toBeInTheDocument();

    resolveRefetch({ ...ticket, status: 'under_review', revision: 4 });
    await waitFor(() => expect(screen.getByText('WEB-101')).toBeInTheDocument());
  });

  it('surfaces a 409 as a reload prompt rather than a silent failure', async () => {
    transitionTicket.mockRejectedValueOnce({
      status: 409,
      code: 'STAGE_CONFLICT',
      message: 'This ticket is now in In Progress. Reload before transitioning.',
      fields: { currentStatus: 'in_progress', currentRevision: 4 },
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('button', { name: /move to under review/i }));

    // A conflict reloads the latest ticket and says so, instead of failing silently.
    await waitFor(() => expect(getTicket).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/changed elsewhere/i),
      expect.objectContaining({ type: 'info' }),
    ));
  });

  it('shows validation dialog and inline date errors when estimates are missing', async () => {
    transitionTicket.mockRejectedValueOnce({
      status: 400,
      code: 'ESTIMATES_REQUIRED',
      message: 'Both an estimated resolution date and an expected release date are required to enter In Progress',
      requestId: '771f225e-862d-4fe7-8ae1-b74ac648ce37',
      fields: {
        estimatedResolutionAt: 'Required',
        expectedReleaseDate: 'Required',
      },
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));
    await userEvent.click(screen.getByRole('button', { name: /move to under review/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /dates required/i })).toBeInTheDocument();
    expect(screen.getByText(/estimated resolution date/i)).toBeInTheDocument();
    expect(screen.getByText(/expected release date/i)).toBeInTheDocument();
    expect(screen.queryByText(/reference:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/771f225e/i)).not.toBeInTheDocument();
    expect(document.getElementById('estimatedResolutionAt')).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('expectedReleaseDate')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows validation dialog when ownership is missing', async () => {
    getTicket.mockResolvedValue({ ...ticket, status: 'ready_local' });
    transitionTicket.mockRejectedValueOnce({
      status: 400,
      code: 'OWNERSHIP_REQUIRED',
      message: 'A team or an assignee is required to enter Ready for QA',
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('button', { name: /move to ready for qa/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /assignment required/i })).toBeInTheDocument();
    expect(screen.getByText(/assign a team or person before moving to ready for qa/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('focuses the first missing date field after dismissing the validation dialog', async () => {
    transitionTicket.mockRejectedValueOnce({
      status: 400,
      code: 'ESTIMATES_REQUIRED',
      message: 'Both an estimated resolution date and an expected release date are required to enter In Progress',
      fields: {
        estimatedResolutionAt: 'Required',
        expectedReleaseDate: 'Required',
      },
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));
    await userEvent.click(screen.getByRole('button', { name: /move to under review/i }));
    await screen.findByRole('alertdialog');
    await userEvent.click(screen.getByRole('button', { name: /got it/i }));

    await waitFor(() => {
      expect(document.getElementById('estimatedResolutionAt')).toHaveFocus();
    });
  });

  it('shows upload loader while uploading files from the drawer', async () => {
    let resolveUpload;
    uploadAttachments.mockImplementation(() => new Promise((resolve) => {
      resolveUpload = resolve;
    }));

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.click(screen.getByRole('tab', { name: /attachments/i }));
    await userEvent.upload(screen.getByLabelText(/choose files to upload/i), png);
    await userEvent.click(screen.getByRole('button', { name: /^upload 1 file$/i }));

    expect(screen.getByRole('status', { name: /uploading attachment/i })).toBeInTheDocument();

    resolveUpload([]);
    await waitFor(() => expect(uploadAttachments).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /uploading attachment/i })).not.toBeInTheDocument();
    });
  });

  it('refetches ticket after sidebar upload succeeds', async () => {
    const withFile = {
      ...ticket,
      attachments: [{ id: 'a1', _id: 'a1', name: 'shot.png', size: 1 }],
    };
    uploadAttachments.mockResolvedValue([{ id: 'a1', name: 'shot.png' }]);
    getTicket
      .mockResolvedValueOnce(ticket)
      .mockResolvedValueOnce(withFile);

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.click(screen.getByRole('tab', { name: /attachments/i }));
    await userEvent.upload(screen.getByLabelText(/choose files to upload/i), png);
    await userEvent.click(screen.getByRole('button', { name: /^upload 1 file$/i }));

    await waitFor(() => expect(uploadAttachments).toHaveBeenCalled());
    await waitFor(() => expect(getTicket).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('shot.png')).toBeInTheDocument();
  });

  it('assigns a team from the metadata rail picker overlay', async () => {
    // A project with its own team locks the team field, so pick from a teamless project.
    getProject.mockResolvedValue(projectWithoutTeamFixture);
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');
    await waitFor(() => expect(getProject).toHaveBeenCalledWith('p1'));

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));
    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    await userEvent.click(within(rail).getByRole('button', { name: /assign team/i }));

    await waitFor(() => expect(listTeams).toHaveBeenCalled());
    const teamListbox = screen.getByRole('listbox');
    await userEvent.click(within(teamListbox).getByRole('option', { name: /platform/i }));

    await waitFor(() => expect(assignTicket).toHaveBeenCalledWith('WEB-101', {
      revision: 3,
      team: 'team-1',
    }));
    expect(showToast).toHaveBeenCalledWith('Team assigned');
    await waitFor(() => expect(getTicket).toHaveBeenCalledTimes(2));
  });

  it('assigns an assignee from the metadata rail picker overlay', async () => {
    assignTicket.mockResolvedValue({
      ...ticket,
      assignedTo: { id: 'u-dev', name: 'Dev User' },
      revision: 4,
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));
    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    await userEvent.click(within(rail).getByRole('button', { name: /assign assignee/i }));

    await waitFor(() => expect(getProject).toHaveBeenCalledWith('p1'));
    const assigneeListbox = screen.getByRole('listbox');
    await userEvent.click(within(assigneeListbox).getByRole('option', { name: /dev user/i }));

    await waitFor(() => expect(assignTicket).toHaveBeenCalledWith('WEB-101', {
      revision: 3,
      assignedTo: 'u-dev',
      team: 'team-1',
    }));
    expect(showToast).toHaveBeenCalledWith('Assignee updated');
  });

  it('shows an edit link to the ticket edit page', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    expect(screen.getByRole('link', { name: /^edit$/i })).toHaveAttribute('href', '/tickets/WEB-101/edit');
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('hides Edit and Delete for view-only users', async () => {
    authState.user = { _id: 'u-ro', id: 'u-ro', role: 'read_only', roles: ['read_only'] };
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    expect(screen.queryByRole('link', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it('hides Delete for developers who can edit', async () => {
    authState.user = { _id: 'u-dev', id: 'u-dev', role: 'developer', roles: ['developer'] };
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    expect(screen.getByRole('link', { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it('assigns a team from the metadata rail for project admin', async () => {
    mockUser = { _id: 'u-pa', id: 'u-pa', role: 'project_admin' };
    authState.user = mockUser;
    getProject.mockResolvedValue(projectWithoutTeamFixture);

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));
    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    await userEvent.click(within(rail).getByRole('button', { name: /assign team/i }));

    await waitFor(() => expect(listTeams).toHaveBeenCalled());
    const teamListbox = screen.getByRole('listbox');
    await userEvent.click(within(teamListbox).getByRole('option', { name: /platform/i }));

    await waitFor(() => expect(assignTicket).toHaveBeenCalledWith('WEB-101', {
      revision: 3,
      team: 'team-1',
    }));
    expect(showToast).toHaveBeenCalledWith('Team assigned');
  });

  it('shows assignee and team as read-only on the Details tab when the metadata rail is hidden', async () => {
    mockUser = { _id: 'u-read', id: 'u-read', role: 'read_only' };
    authState.user = mockUser;
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));

    expect(screen.queryByRole('complementary', { name: /ticket metadata/i })).not.toBeInTheDocument();

    const details = document.getElementById('panel-details');
    expect(within(details).queryByRole('combobox', { name: /^assignee$/i })).not.toBeInTheDocument();
    expect(within(details).queryByRole('combobox', { name: /^team$/i })).not.toBeInTheDocument();
    expect(within(details).getByText('Assignee')).toBeInTheDocument();
    expect(within(details).getByText('Team')).toBeInTheDocument();
  });

  it('shows editable estimate dates in the metadata rail for project admin', async () => {
    mockUser = { _id: 'u-pa', id: 'u-pa', role: 'project_admin' };
    authState.user = mockUser;

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');
    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));

    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    expect(document.getElementById('estimatedResolutionAt')).toBeInTheDocument();
    expect(document.getElementById('expectedReleaseDate')).toBeInTheDocument();
    expect(rail.contains(document.getElementById('estimatedResolutionAt'))).toBe(true);
  });

  it('assigns a team from the metadata rail for project admin and reloads', async () => {
    mockUser = { _id: 'u-pa', id: 'u-pa', role: 'project_admin' };
    authState.user = mockUser;
    getProject.mockResolvedValue(projectWithoutTeamFixture);

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');
    await waitFor(() => expect(listTeams).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));

    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    await userEvent.click(within(rail).getByRole('button', { name: /assign team/i }));
    const teamListbox = screen.getByRole('listbox');
    await userEvent.click(within(teamListbox).getByRole('option', { name: /platform/i }));

    await waitFor(() => expect(assignTicket).toHaveBeenCalledWith('WEB-101', {
      revision: 3,
      team: 'team-1',
    }));
    expect(showToast).toHaveBeenCalledWith('Team assigned');
    await waitFor(() => expect(getTicket).toHaveBeenCalledTimes(2));
  });

  it('assigns an assignee from the metadata rail for project admin', async () => {
    mockUser = { _id: 'u-pa', id: 'u-pa', role: 'project_admin' };
    authState.user = mockUser;
    assignTicket.mockResolvedValue({
      ...ticket,
      assignedTo: { id: 'u-dev', name: 'Dev User' },
      revision: 4,
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');
    await waitFor(() => expect(getProject).toHaveBeenCalledWith('p1'));

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));

    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    await userEvent.click(within(rail).getByRole('button', { name: /assign assignee/i }));
    const assigneeListbox = screen.getByRole('listbox');
    await userEvent.click(within(assigneeListbox).getByRole('option', { name: /dev user/i }));

    await waitFor(() => expect(assignTicket).toHaveBeenCalledWith('WEB-101', {
      revision: 3,
      assignedTo: 'u-dev',
      team: 'team-1',
    }));
    expect(showToast).toHaveBeenCalledWith('Assignee updated');
  });

  it('reverts metadata rail picker and toasts on assignment failure for project admin', async () => {
    mockUser = { _id: 'u-pa', id: 'u-pa', role: 'project_admin' };
    authState.user = mockUser;
    getProject.mockResolvedValue(projectWithoutTeamFixture);
    assignTicket.mockRejectedValueOnce({
      status: 409,
      message: 'Ticket was updated elsewhere. Reload and try again.',
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');
    await waitFor(() => expect(listTeams).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));

    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    await userEvent.click(within(rail).getByRole('button', { name: /assign team/i }));
    const teamListbox = screen.getByRole('listbox');
    await userEvent.click(within(teamListbox).getByRole('option', { name: /platform/i }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Ticket was updated elsewhere. Reload and try again.'));
  });
});


