import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Page from '../page.jsx';

const listTickets = vi.fn();
const transitionTicket = vi.fn();
const getTicket = vi.fn();

vi.mock('@/shared/api/tickets.js', () => ({
  listTickets: (...args) => listTickets(...args),
  transitionTicket: (...args) => transitionTicket(...args),
  getTicket: (...args) => getTicket(...args),
}));

const useAuth = vi.fn();
vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => useAuth(),
}));

vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: () => ({ activeProjectId: null }),
}));

vi.mock('@/shared/contexts/ticket-preferences-context.jsx', () => ({
  useTicketPreferences: () => ({
    ready: true,
    preferences: { filters: { scope: 'all' } },
    boardMine: false,
    setBoardMine: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/use-board-policy.js', () => ({
  useBoardPolicy: () => ({ policy: undefined }),
}));

vi.mock('@/shared/hooks/use-permission-context.js', () => ({
  usePermissionContext: () => ({ permissionContext: {} }),
}));

vi.mock('@/shared/contexts/realtime-context.jsx', () => ({
  useRealtime: () => ({ connected: false }),
  useRealtimeEvent: () => {},
}));

vi.mock('@/shared/lib/notification-swr.js', () => ({
  useNotificationPollInterval: () => 60_000,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets/board',
}));

vi.mock('@/shared/lib/use-history-search.js', () => ({
  useHistorySearch: () => '',
}));

vi.mock('next/link', () => ({
  default: ({ children, href }) => <a href={href}>{children}</a>,
}));

function dropOnLane(testId, ticketId) {
  const zone = screen.getByTestId(testId);
  const event = Object.assign(new Event('drop', { bubbles: true }), {
    dataTransfer: { getData: () => ticketId },
    preventDefault: () => {},
  });
  zone.dispatchEvent(event);
}

const ticket = {
  id: 't1',
  ticketId: 'WEB-1',
  title: 'Ship it',
  status: 'deployed_staging',
  revision: 2,
  createdBy: { id: 'reporter-1' },
  assignedTo: { id: 'u-qa' },
};

describe('BoardPage drop handling', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({
      user: {
        id: 'u-qa', _id: 'u-qa', role: 'tester', roles: ['tester'],
      },
    });
    vi.spyOn(window, 'setInterval').mockImplementation(() => 0);
    vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
    listTickets.mockReset().mockResolvedValue({ results: [ticket] });
    transitionTicket.mockReset().mockResolvedValue({ ...ticket, status: 'in_progress', revision: 3 });
    getTicket.mockReset().mockResolvedValue(ticket);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a QA-lane drop opens the RemarkDialog as a Reject and sends { to, revision, note }', async () => {
    render(<Page />);
    await screen.findByText('WEB-1');

    // Dropping into the "development" lane targets in_progress — a backward
    // move from deployed_staging. Out of the QA lane that is a REJECTION, so
    // the dialog says Reject and asks for a QA report, not a reopen note.
    dropOnLane('lane-development', 'WEB-1');

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/Reject WEB-1/i);
    expect(screen.getByLabelText(/QA report \(required to reject\)/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/QA report \(required to reject\)/i), 'Regressed on staging');
    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }));

    await waitFor(() => expect(transitionTicket).toHaveBeenCalledWith('WEB-1', {
      to: 'in_progress', revision: 2, note: 'Regressed on staging',
    }));
  });

  it('a drop from outside the QA lane still reads as a Reopen', async () => {
    useAuth.mockReturnValue({
      user: {
        id: 'u-dev', _id: 'u-dev', role: 'developer', roles: ['developer'],
      },
    });
    listTickets.mockResolvedValue({ results: [{ ...ticket, status: 'closed' }] });
    getTicket.mockResolvedValue({ ...ticket, status: 'closed' });

    render(<Page />);
    await screen.findByText('WEB-1');

    dropOnLane('lane-development', 'WEB-1');

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/Reopen WEB-1/i);
    expect(screen.getByLabelText(/Note \(required to reopen\)/i)).toBeInTheDocument();
  });

  it('treats SAME_STAGE as a silent no-op without an error banner or console noise', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((msg) => {
      if (typeof msg === 'string' && msg.includes('[PMS]')) {
        throw new Error(`unexpected PMS log: ${msg}`);
      }
    });
    listTickets.mockResolvedValue({ results: [{ ...ticket, status: 'in_progress' }] });
    getTicket.mockResolvedValue({ ...ticket, status: 'in_progress' });

    render(<Page />);
    await screen.findByText('WEB-1');

    dropOnLane('lane-development', 'WEB-1');

    await waitFor(() => {
      expect(transitionTicket).not.toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const pmsLogs = consoleSpy.mock.calls.filter((call) => String(call[0]).includes('[PMS]'));
    expect(pmsLogs).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it('surfaces a getTicket failure on drop through the error banner instead of an unhandled rejection', async () => {
    listTickets.mockResolvedValue({ results: [] });
    getTicket.mockRejectedValueOnce({ status: 500, code: 'SERVER_ERROR', message: 'boom' });

    render(<Page />);
    await waitFor(() => expect(listTickets).toHaveBeenCalled());

    dropOnLane('lane-development', 'WEB-1');

    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/i);
  });

  it('pages past the API row cap so every lane gets its tickets', async () => {
    const later = { ...ticket, id: 't2', ticketId: 'WEB-2', title: 'On page two' };
    listTickets.mockImplementation((query) => {
      if (query.page === 1) {
        return Promise.resolve({ results: [ticket], totalPages: 2, page: 1, totalResults: 2 });
      }
      if (query.page === 2) {
        return Promise.resolve({ results: [later], totalPages: 2, page: 2, totalResults: 2 });
      }
      return Promise.resolve({ results: [], totalPages: 2, page: query.page, totalResults: 2 });
    });

    render(<Page />);

    await waitFor(() => {
      expect(listTickets.mock.calls.some((call) => call[0]?.page === 2)).toBe(true);
    });
    expect(await screen.findByText('On page two', { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Ship it')).toBeInTheDocument();
  });
});
