import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketsPage from '../page.jsx';

/* --------------------------------------------------------------------------
 * What this file locks down:
 *   P0  1. a persisted owner filter the current project cannot show
 *       2. one API request per keystroke, with no aborts
 *       3. ?page= thrown away on mount
 *   P1  4. the drawer sitting outside the history stack
 *       5. a filtered view that no URL can describe
 * ----------------------------------------------------------------------- */

const listTickets = vi.fn();
const getProject = vi.fn();
const listUsers = vi.fn();
const setFilters = vi.fn();
const setActiveProjectId = vi.fn();
const showToast = vi.fn();

let projectState = { activeProjectId: 'proj-1', loading: false };
let preferencesState;

// jsdom's real history is used throughout, so window.location.search — which
// the page builds every URL from — is genuinely correct. The spies only record.
const realReplaceState = window.history.replaceState.bind(window.history);
const setUrl = (search) => realReplaceState(null, '', `/tickets${search}`);

vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets',
  // Mirrors what Next does: useSearchParams tracks the native history API.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  AUTHENTICATED: 'authenticated',
  useAuth: () => ({ status: 'authenticated' }),
}));

vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: () => ({ ...projectState, setActiveProjectId }),
}));

vi.mock('@/shared/contexts/ticket-preferences-context.jsx', () => ({
  useTicketPreferences: () => ({
    ready: true,
    preferences: preferencesState,
    setFilters: (...args) => setFilters(...args),
    setSort: vi.fn(),
    patchPreferences: vi.fn(),
    reset: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/shared/api/tickets.js', () => ({
  listTickets: (...args) => listTickets(...args),
}));

vi.mock('@/shared/api/projects.js', () => ({
  getProject: (...args) => getProject(...args),
}));

vi.mock('@/shared/api/users.js', () => ({
  listUsers: (...args) => listUsers(...args),
}));

vi.mock('@/shared/lib/toast.js', () => ({
  showToast: (...args) => showToast(...args),
}));

vi.mock('@/shared/components/tickets/ticket-detail-drawer.jsx', () => ({
  default: ({ ticketId, onClose }) => (
    <div data-testid="drawer">
      <span data-testid="drawer-ticket">{ticketId}</span>
      <button type="button" onClick={onClose}>Close drawer</button>
    </div>
  ),
}));

const emptyPage = { results: [], totalResults: 0, page: 1, totalPages: 1 };
const oneTicket = {
  results: [{ id: 't1', ticketId: 'WEB-63', title: 'Login broken', status: 'pending' }],
  totalResults: 1,
  page: 1,
  totalPages: 1,
};

const prefs = (filters = {}) => ({
  filters: {
    q: '', status: '', priority: '', scope: 'all', assignedTo: '',
    blocked: false, overdue: false, reopened: false, ...filters,
  },
  sort: { column: 'ticketId', direction: 'desc' },
  boardMine: false,
  limit: 25,
});

const member = (id, name) => ({ user: { id, name } });

/** The params of the most recent list request. */
const lastQuery = () => listTickets.mock.calls.at(-1)[0];

let pushState;
let replaceState;
let historyBack;

/** Assert selected URL params without caring about param order. */
const expectSearch = (expected) => {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(expected)) {
    expect(params.get(key)).toBe(value);
  }
};

const expectSearchAbsent = (...keys) => {
  const params = new URLSearchParams(window.location.search);
  for (const key of keys) expect(params.has(key)).toBe(false);
};

beforeEach(() => {
  vi.clearAllMocks();
  projectState = { activeProjectId: 'proj-1', loading: false };
  preferencesState = prefs();
  listTickets.mockResolvedValue(emptyPage);
  getProject.mockResolvedValue({ teamMembers: [member('u1', 'Ada'), member('u2', 'Lin')] });
  listUsers.mockResolvedValue({ results: [{ id: 'u1', name: 'Ada' }, { id: 'u2', name: 'Lin' }] });
  setActiveProjectId.mockClear();

  setUrl('');
  pushState = vi.spyOn(window.history, 'pushState');
  replaceState = vi.spyOn(window.history, 'replaceState');
  historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  pushState.mockRestore();
  replaceState.mockRestore();
  historyBack.mockRestore();
});

describe('owner filter that the current project cannot show', () => {
  it('clears an owner the resolved project does not offer', async () => {
    preferencesState = prefs({ assignedTo: 'gone-from-team' });
    setUrl('?assignedTo=gone-from-team');

    render(<TicketsPage />);

    await waitFor(() => expect(setFilters).toHaveBeenCalled());
    expect(setFilters.mock.calls.at(-1)[0].assignedTo).toBe('');
    expect(window.location.search).not.toContain('assignedTo');
  });

  it('keeps an owner the project does offer', async () => {
    preferencesState = prefs({ assignedTo: 'u2' });
    setUrl('?assignedTo=u2');

    render(<TicketsPage />);

    await waitFor(() => expect(listTickets).toHaveBeenCalled());
    expect(setFilters).not.toHaveBeenCalled();
    expect(lastQuery().assignedTo).toBe('u2');
  });

  it('does not clear while the project list is still loading', async () => {
    // activeProjectId is null here for "loading", not for "all projects".
    preferencesState = prefs({ assignedTo: 'u9' });
    setUrl('?assignedTo=u9');
    projectState = { activeProjectId: null, loading: true };

    render(<TicketsPage />);

    await act(async () => {});
    expect(setFilters).not.toHaveBeenCalled();
  });

  it('does not clear when the project lookup fails', async () => {
    preferencesState = prefs({ assignedTo: 'u9' });
    setUrl('?assignedTo=u9');
    getProject.mockRejectedValue(new Error('boom'));

    render(<TicketsPage />);

    await waitFor(() => expect(getProject).toHaveBeenCalled());
    await act(async () => {});
    expect(setFilters).not.toHaveBeenCalled();
  });

  it('does not clear an unknown owner under All Projects because the user list is capped', async () => {
    preferencesState = prefs({ assignedTo: 'unknown' });
    setUrl('?assignedTo=unknown');
    projectState = { activeProjectId: null, loading: false };
    listUsers.mockResolvedValue({ results: [{ id: 'u1', name: 'Ada' }] });

    render(<TicketsPage />);

    await waitFor(() => expect(listUsers).toHaveBeenCalled());
    expect(setFilters).not.toHaveBeenCalled();
    expect(lastQuery().assignedTo).toBe('unknown');
  });

  it('keeps an owner under All Projects when they appear in the global user list', async () => {
    preferencesState = prefs({ assignedTo: 'u1' });
    setUrl('?assignedTo=u1');
    projectState = { activeProjectId: null, loading: false };

    render(<TicketsPage />);

    await waitFor(() => expect(listUsers).toHaveBeenCalled());
    expect(setFilters).not.toHaveBeenCalled();
    expect(lastQuery().assignedTo).toBe('u1');
  });
});

describe('search requests', () => {
  it('sends one request for a burst of typing, not one per keystroke', async () => {
    vi.useFakeTimers();
    render(<TicketsPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const afterMount = listTickets.mock.calls.length;
    const input = screen.getByLabelText('Filter tickets');

    for (const q of ['a', 'ad', 'adm', 'admi', 'admin']) {
      fireEvent.change(input, { target: { value: q } });
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    }

    expect(listTickets.mock.calls.length).toBe(afterMount);

    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(listTickets.mock.calls.length).toBe(afterMount + 1);
    expect(lastQuery().q).toBe('admin');
  });

  it('keeps the search input responsive on every keystroke', async () => {
    render(<TicketsPage />);
    await waitFor(() => expect(listTickets).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText('Filter tickets'), 'ab');

    expect(screen.getByLabelText('Filter tickets')).toHaveValue('ab');
  });

  it('aborts a request that a newer one supersedes', async () => {
    const signals = [];
    listTickets.mockImplementation((_params, options) => {
      signals.push(options.signal);
      return Promise.resolve(emptyPage);
    });

    const { rerender } = render(<TicketsPage />);
    await waitFor(() => expect(signals.length).toBe(1));

    setUrl('?page=2');
    rerender(<TicketsPage />);
    await waitFor(() => expect(signals.length).toBe(2));

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('passes an AbortSignal on every list request', async () => {
    render(<TicketsPage />);
    await waitFor(() => expect(listTickets).toHaveBeenCalled());
    expect(listTickets.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('page in the URL', () => {
  it('requests the page named by the URL instead of resetting to 1', async () => {
    setUrl('?page=3');
    listTickets.mockResolvedValue({ results: [], totalResults: 90, page: 3, totalPages: 4 });

    render(<TicketsPage />);

    await waitFor(() => expect(listTickets).toHaveBeenCalled());
    expect(lastQuery().page).toBe(3);
    expectSearch({ page: '3', project: 'proj-1' });
  });

  it('honours a page size from the URL over the saved preference', async () => {
    setUrl('?page=2&limit=50');
    listTickets.mockResolvedValue({ results: [], totalResults: 90, page: 2, totalPages: 2 });

    render(<TicketsPage />);

    await waitFor(() => expect(listTickets).toHaveBeenCalled());
    expect(lastQuery().limit).toBe(50);
  });

  it('ignores a page size the API would reject', async () => {
    setUrl('?limit=999');

    render(<TicketsPage />);

    await waitFor(() => expect(listTickets).toHaveBeenCalled());
    expect(lastQuery().limit).toBe(25);
  });

  it('writes the page to the URL and keeps an open ticket in it', async () => {
    listTickets.mockResolvedValue({ ...emptyPage, totalResults: 60, totalPages: 3 });
    setUrl('?ticket=WEB-63');

    render(<TicketsPage />);
    await waitFor(() => expect(listTickets).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expectSearch({ ticket: 'WEB-63', page: '2', project: 'proj-1' });
  });

  it('resets to page 1 when the project changes, but not on first load', async () => {
    setUrl('?page=4');
    listTickets.mockResolvedValue({ results: [], totalResults: 200, page: 4, totalPages: 8 });

    const { rerender } = render(<TicketsPage />);
    await waitFor(() => expect(listTickets).toHaveBeenCalled());
    expectSearch({ page: '4', project: 'proj-1' });

    projectState = { activeProjectId: 'proj-2', loading: false };
    rerender(<TicketsPage />);

    await waitFor(() => expectSearch({ project: 'proj-2' }));
    expectSearchAbsent('page');
  });
});

describe('filters in the URL', () => {
  it('lets the URL win over saved preferences, for every filter', async () => {
    // The recipient of a shared link must see what its sender saw.
    preferencesState = prefs({ status: 'blocked', priority: 'Urgent' });
    setUrl('?status=review');

    render(<TicketsPage />);

    await waitFor(() => expect(listTickets).toHaveBeenCalled());
    expect(lastQuery().status).toBe('review');
    expect(lastQuery().priority).toBe(undefined);
  });

  it('falls back to saved preferences when the URL names no filter', async () => {
    preferencesState = prefs({ status: 'blocked' });
    setUrl('?page=2');
    listTickets.mockResolvedValue({ results: [], totalResults: 60, page: 2, totalPages: 3 });

    render(<TicketsPage />);

    await waitFor(() => expect(listTickets).toHaveBeenCalled());
    expect(lastQuery().status).toBe('blocked');
  });

  it('normalizes saved filters into the URL so a bare view is still shareable', async () => {
    preferencesState = prefs({ status: 'blocked', overdue: true });
    setUrl('');

    render(<TicketsPage />);

    await waitFor(() => {
      expectSearch({ status: 'blocked', overdue: '1', project: 'proj-1' });
    });
  });

  it('writes a filter change to the URL and returns to page 1', async () => {
    setUrl('?page=5&project=proj-1');
    listTickets.mockResolvedValue({ results: [], totalResults: 300, page: 5, totalPages: 12 });

    render(<TicketsPage />);
    await waitFor(() => expect(listTickets).toHaveBeenCalled());

    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'Urgent');

    expectSearch({ priority: 'Urgent', project: 'proj-1' });
    expectSearchAbsent('page');
    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({ priority: 'Urgent' }));
  });

  it('removes a filter from the URL when it is switched off', async () => {
    setUrl('?blocked=1&project=proj-1');

    render(<TicketsPage />);
    await waitFor(() => expect(listTickets).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Blocked' }));

    expect(window.location.search).toBe('?project=proj-1');
  });

  it('clears the URL filters on reset, not just the stored defaults', async () => {
    preferencesState = prefs({ status: 'review' });
    setUrl('?status=review&page=3');
    listTickets.mockResolvedValue({ results: [], totalResults: 90, page: 3, totalPages: 4 });

    render(<TicketsPage />);
    await waitFor(() => expect(listTickets).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

    await waitFor(() => expect(window.location.search).toBe('?project=proj-1'));
  });
});

describe('the drawer in the history stack', () => {
  beforeEach(() => {
    listTickets.mockResolvedValue(oneTicket);
  });

  it('opens a ticket as its own history entry', async () => {
    render(<TicketsPage />);
    await waitFor(() => expect(screen.getByLabelText(/Open ticket WEB-63/)).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText(/Open ticket WEB-63/));

    // pushState, not replaceState: Back has to have somewhere to go.
    expect(pushState).toHaveBeenCalledWith(null, '', expect.stringContaining('ticket=WEB-63'));
    expectSearch({ ticket: 'WEB-63', project: 'proj-1' });
  });

  it('closes a ticket it opened by going back, consuming the entry', async () => {
    const { rerender } = render(<TicketsPage />);
    await waitFor(() => expect(screen.getByLabelText(/Open ticket WEB-63/)).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText(/Open ticket WEB-63/));
    // Stands in for the re-render Next drives off the native history API.
    rerender(<TicketsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Close drawer' }));

    // Otherwise Back would walk straight back into the drawer you just closed.
    expect(historyBack).toHaveBeenCalledTimes(1);
  });

  it('keeps a page change made behind the drawer instead of going back past it', async () => {
    listTickets.mockResolvedValue({ ...oneTicket, totalResults: 60, totalPages: 3 });

    const { rerender } = render(<TicketsPage />);
    await waitFor(() => expect(screen.getByLabelText(/Open ticket WEB-63/)).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText(/Open ticket WEB-63/));
    rerender(<TicketsPage />);

    // Something moved the list on underneath the drawer — the clamp does this.
    setUrl('?ticket=WEB-63&page=2&project=proj-1');
    rerender(<TicketsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Close drawer' }));

    // Going back would have restored page 1 and thrown the move away.
    expect(historyBack).not.toHaveBeenCalled();
    expectSearch({ page: '2', project: 'proj-1' });
    expectSearchAbsent('ticket');
  });

  it('closes a deep-linked ticket without leaving the site', async () => {
    setUrl('?ticket=WEB-63&project=proj-1');

    render(<TicketsPage />);
    await waitFor(() => expect(screen.getByTestId('drawer')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Close drawer' }));

    // There is no entry of ours behind this one — going back would exit.
    expect(historyBack).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?project=proj-1');
  });

  it('takes the open ticket from the URL, so back and forward drive the drawer', async () => {
    setUrl('?ticket=WEB-99');
    const { rerender } = render(<TicketsPage />);

    await waitFor(() => expect(screen.getByTestId('drawer-ticket')).toHaveTextContent('WEB-99'));

    setUrl('');
    rerender(<TicketsPage />);

    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  it('syncs the drawer when popstate changes ?ticket=', async () => {
    setUrl('?project=proj-1');
    const { rerender } = render(<TicketsPage />);
    await waitFor(() => expect(listTickets).toHaveBeenCalled());

    act(() => {
      setUrl('?ticket=WEB-55&project=proj-1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    rerender(<TicketsPage />);

    await waitFor(() => expect(screen.getByTestId('drawer-ticket')).toHaveTextContent('WEB-55'));
  });
});
