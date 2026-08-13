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

  it('loads the ticket by its human id and shows the sections', async () => {
    render(<TicketDetailDrawer ticketId="WEB-101" onClose={() => {}} onChanged={() => {}} />);

    await waitFor(() => expect(getTicket).toHaveBeenCalledWith('WEB-101'));
    expect(await screen.findByText('WEB-101')).toBeInTheDocument();
    for (const heading of ['Stage', 'Details', 'History', 'Comments', 'Attachments']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
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
});
