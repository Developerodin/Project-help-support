import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketDetailDrawer from '../ticket-detail-drawer.jsx';

const getTicket = vi.fn();
const transitionTicket = vi.fn();

vi.mock('@/shared/api/tickets.js', () => ({
  getTicket: (...args) => getTicket(...args),
  transitionTicket: (...args) => transitionTicket(...args),
  patchTicket: vi.fn(),
  addComment: vi.fn(),
  uploadAttachments: vi.fn(),
  attachmentDownloadUrl: () => '/x',
  watchTicket: vi.fn(),
  unwatchTicket: vi.fn(),
  setBlocked: vi.fn(),
  clearBlocked: vi.fn(),
}));
vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({ user: { _id: 'u-admin', id: 'u-admin', role: 'admin' } }),
}));

const ticket = {
  id: 't1', ticketId: 'WEB-101', title: 'Broken login', description: 'Nothing happens',
  status: 'pending', revision: 3, createdBy: { id: 'u-admin', name: 'Root' },
  comments: [], attachments: [], stageHistory: [], activityLog: [], labels: [],
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('TicketDetailDrawer', () => {
  beforeEach(() => {
    getTicket.mockReset().mockResolvedValue(ticket);
    transitionTicket.mockReset()
      .mockResolvedValue({ ...ticket, status: 'under_review', revision: 4 });
  });

  it('loads the ticket by its human id and shows the drawer layout', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);

    await waitFor(() => expect(getTicket).toHaveBeenCalledWith('WEB-101'));
    expect(await screen.findByText('WEB-101')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stage', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Details', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /discussion/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /ticket details/i })).toBeInTheDocument();
    expect(screen.getByText('Intake')).toBeInTheDocument();
    expect(screen.getByText('Development')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attach/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/add a comment/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /history/i }));
    expect(screen.getByText(/no stage changes recorded yet/i)).toBeInTheDocument();
  });

  it('closing calls back — it does not navigate', async () => {
    const onClose = vi.fn();
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={onClose} onChanged={() => {}} />);

    await screen.findByText('WEB-101');
    await userEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('sends the loaded revision with a transition', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('WEB-101');

    await userEvent.click(screen.getByRole('button', { name: /move to/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Under Review' }));

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

    await userEvent.click(screen.getByRole('button', { name: /move to/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Under Review' }));

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

    await userEvent.click(screen.getByRole('button', { name: /move to/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'In Progress' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /dates required/i })).toBeInTheDocument();
    expect(screen.getByText(/estimated resolution date/i)).toBeInTheDocument();
    expect(screen.getByText(/expected release date/i)).toBeInTheDocument();
    expect(screen.queryByText(/reference:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/771f225e/i)).not.toBeInTheDocument();
    expect(document.getElementById('estimatedResolutionAt')).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('expectedReleaseDate')).toHaveAttribute('aria-invalid', 'true');
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

    await userEvent.click(screen.getByRole('button', { name: /move to/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'In Progress' }));
    await screen.findByRole('alertdialog');
    await userEvent.click(screen.getByRole('button', { name: /got it/i }));

    await waitFor(() => {
      expect(document.getElementById('estimatedResolutionAt')).toHaveFocus();
    });
  });
});
