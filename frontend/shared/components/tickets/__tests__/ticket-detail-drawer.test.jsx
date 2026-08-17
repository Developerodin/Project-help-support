import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketDetailDrawer from '../ticket-detail-drawer.jsx';

const getTicket = vi.fn();
const transitionTicket = vi.fn();
const uploadAttachments = vi.fn();
const assignTicket = vi.fn();
const listTeams = vi.fn();
const getProject = vi.fn();
const showToast = vi.fn();

vi.mock('@/shared/api/tickets.js', () => ({
  getTicket: (...args) => getTicket(...args),
  transitionTicket: (...args) => transitionTicket(...args),
  patchTicket: vi.fn(),
  assignTicket: (...args) => assignTicket(...args),
  addComment: vi.fn(),
  uploadAttachments: (...args) => uploadAttachments(...args),
  attachmentDownloadUrl: () => '/x',
  resolveAttachmentDownloadUrl: vi.fn().mockResolvedValue('https://example.com/shot.png'),
  watchTicket: vi.fn(),
  unwatchTicket: vi.fn(),
  setBlocked: vi.fn(),
  clearBlocked: vi.fn(),
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
  useAuth: () => ({ user: { _id: 'u-admin', id: 'u-admin', role: 'admin' } }),
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

describe('TicketDetailDrawer', () => {
  beforeEach(() => {
    getTicket.mockReset().mockResolvedValue(ticket);
    transitionTicket.mockReset()
      .mockResolvedValue({ ...ticket, status: 'under_review', revision: 4 });
    uploadAttachments.mockReset().mockResolvedValue([]);
    assignTicket.mockReset().mockResolvedValue({ ...ticket, team: { id: 'team-1', name: 'Platform' }, revision: 4 });
    listTeams.mockReset().mockResolvedValue({
      results: [{ id: 'team-1', _id: 'team-1', name: 'Platform', project: { key: 'WEB' } }],
    });
    getProject.mockReset().mockResolvedValue(projectTeamFixture);
    showToast.mockReset();
  });

  it('loads the ticket by its human id and shows the three-section drawer layout', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);

    await waitFor(() => expect(getTicket).toHaveBeenCalledWith('WEB-101'));
    expect(await screen.findByText('WEB-101')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stage', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /discussion/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^details$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /history/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /ticket metadata/i })).toBeInTheDocument();
    expect(screen.getByText('Intake')).toBeInTheDocument();
    expect(screen.getByText('Development')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attach/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/add a comment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to under review/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));
    expect(screen.getByRole('heading', { name: 'Details', hidden: true })).toBeInTheDocument();
    expect(screen.getByText('Estimates')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /history/i }));
    expect(screen.getByText(/no stage changes recorded yet/i)).toBeInTheDocument();
  });

  it('keeps metadata rail out of the discussion tab scroll area', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    const discussion = document.getElementById('panel-discussion');
    expect(discussion).toBeTruthy();
    const discussionScope = within(discussion);

    expect(discussionScope.queryByText('Resolution estimate')).not.toBeInTheDocument();
    expect(discussionScope.queryByText('Expected release')).not.toBeInTheDocument();
    expect(discussionScope.queryByText('In current stage')).not.toBeInTheDocument();
    expect(discussionScope.queryByLabelText(/add attachments/i)).not.toBeInTheDocument();
    expect(discussionScope.getByRole('button', { name: /^attach$/i })).toBeInTheDocument();
    expect(discussionScope.getByLabelText(/add a comment/i)).toBeInTheDocument();

    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    expect(within(rail).getByText('Resolution estimate')).toBeInTheDocument();
    expect(within(rail).getByText('Assignee')).toBeInTheDocument();
  });

  it('closing calls back â€” it does not navigate', async () => {
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/reload/i);
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

    await userEvent.click(screen.getByRole('listitem', { name: 'In Progress' }));

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
    transitionTicket.mockRejectedValueOnce({
      status: 400,
      code: 'OWNERSHIP_REQUIRED',
      message: 'A team or an assignee is required to enter Ready for QA',
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('listitem', { name: 'Ready for QA' }));

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

    await userEvent.click(screen.getByRole('listitem', { name: 'In Progress' }));
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
    await userEvent.upload(screen.getByLabelText(/add attachments/i), png);
    await userEvent.click(screen.getByRole('button', { name: /^upload$/i }));

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
    await userEvent.upload(screen.getByLabelText(/add attachments/i), png);
    await userEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => expect(uploadAttachments).toHaveBeenCalled());
    await waitFor(() => expect(getTicket).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('shot.png')).toBeInTheDocument();
  });

  it('assigns a team from the metadata rail picker overlay', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    await userEvent.click(within(rail).getByRole('button', { name: /assign team/i }));

    await waitFor(() => expect(listTeams).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole('option', { name: /platform/i }));

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

    const rail = screen.getByRole('complementary', { name: /ticket metadata/i });
    await userEvent.click(within(rail).getByRole('button', { name: /assign assignee/i }));

    await waitFor(() => expect(getProject).toHaveBeenCalledWith('p1'));
    await userEvent.click(await screen.findByRole('option', { name: /dev user/i }));

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
  });

  it('assigns a team from the details tab dropdown', async () => {
    getProject.mockResolvedValue(projectWithoutTeamFixture);

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await waitFor(() => expect(listTeams).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));
    const details = document.getElementById('panel-details');
    await userEvent.selectOptions(within(details).getByLabelText(/^team$/i), 'team-1');

    await waitFor(() => expect(assignTicket).toHaveBeenCalledWith('WEB-101', {
      revision: 3,
      team: 'team-1',
    }));
    expect(showToast).toHaveBeenCalledWith('Team assigned');
  });

  it('shows assignee and team dropdowns on the Details tab for admins', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await waitFor(() => expect(getProject).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(listTeams).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));

    const details = document.getElementById('panel-details');
    expect(within(details).getByRole('combobox', { name: /^assignee$/i })).toBeInTheDocument();
    expect(within(details).getByRole('combobox', { name: /^team$/i })).toBeInTheDocument();
    expect(within(details).getByRole('option', { name: /dev user/i })).toBeInTheDocument();
    expect(within(details).getByRole('option', { name: /platform/i })).toBeInTheDocument();
  });

  it('assigns a team from the Details tab dropdown', async () => {
    getProject.mockResolvedValue(projectWithoutTeamFixture);

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');
    await waitFor(() => expect(listTeams).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));

    const details = document.getElementById('panel-details');
    await userEvent.selectOptions(
      within(details).getByRole('combobox', { name: /^team$/i }),
      'team-1',
    );

    await waitFor(() => expect(assignTicket).toHaveBeenCalledWith('WEB-101', {
      revision: 3,
      team: 'team-1',
    }));
    expect(showToast).toHaveBeenCalledWith('Team assigned');
    await waitFor(() => expect(getTicket).toHaveBeenCalledTimes(2));
  });

  it('assigns an assignee from the Details tab dropdown', async () => {
    assignTicket.mockResolvedValue({
      ...ticket,
      assignedTo: { id: 'u-dev', name: 'Dev User' },
      revision: 4,
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');
    await waitFor(() => expect(getProject).toHaveBeenCalledWith('p1'));

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));

    const details = document.getElementById('panel-details');
    await userEvent.selectOptions(
      within(details).getByRole('combobox', { name: /^assignee$/i }),
      'u-dev',
    );

    await waitFor(() => expect(assignTicket).toHaveBeenCalledWith('WEB-101', {
      revision: 3,
      assignedTo: 'u-dev',
      team: 'team-1',
    }));
    expect(showToast).toHaveBeenCalledWith('Assignee updated');
  });

  it('reverts Details tab dropdown and toasts on assignment failure', async () => {
    getProject.mockResolvedValue(projectWithoutTeamFixture);
    assignTicket.mockRejectedValueOnce({
      status: 409,
      message: 'Ticket was updated elsewhere. Reload and try again.',
    });

    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');
    await waitFor(() => expect(listTeams).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('tab', { name: /^details$/i }));

    const details = document.getElementById('panel-details');
    const teamSelect = within(details).getByRole('combobox', { name: /^team$/i });
    expect(teamSelect).toHaveValue('');

    await userEvent.selectOptions(teamSelect, 'team-1');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Ticket was updated elsewhere. Reload and try again.'));
    expect(teamSelect).toHaveValue('');
  });
});


