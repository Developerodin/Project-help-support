import {
  act, cleanup, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import AuditLogView from '@/shared/components/rbac/audit-log-view.jsx';
import { AUDIT_ACTION_LABELS } from '@/shared/lib/rbac/audit-log-format.js';

vi.mock('@/shared/api/rbac.js', () => ({
  listAuditLog: vi.fn(),
  exportAuditLogCsv: vi.fn(),
  getAuditOutboxStats: vi.fn(),
}));

vi.mock('@/shared/api/users.js', () => ({
  getUser: vi.fn(),
  listUsers: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/audit-log',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { listAuditLog } from '@/shared/api/rbac.js';
import { getUser, listUsers } from '@/shared/api/users.js';

const ACTOR_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

// jsdom's real history is used, so window.location.search is genuinely correct.
// Next re-renders useSearchParams consumers after replaceState; popstate stands in for that here.
const realReplaceState = window.history.replaceState.bind(window.history);
const setUrl = (search) => realReplaceState(null, '', `/audit-log${search}`);
let replaceState;

const searchParam = (key) => new URLSearchParams(window.location.search).get(key);
const lastQuery = () => listAuditLog.mock.calls.at(-1)[0];

async function waitForAuditAction(actionTitle) {
  await waitFor(() => {
    expect(screen.getAllByTitle(actionTitle).length).toBeGreaterThan(0);
  });
}

const accessRow = {
  id: 'a1',
  createdAt: '2026-08-24T10:00:00.000Z',
  category: 'access',
  action: 'scoped_assignment.create',
  actor: { name: 'Admin' },
  targetUser: { email: 'dev@example.com' },
  details: { role: 'developer', clientId: 'c1' },
};

const policyRow = {
  ...accessRow, id: 'p1', category: 'policy', action: 'role_matrix.reset', details: {},
};

const whatsappRow = {
  id: 'w1',
  createdAt: '2026-08-24T11:00:00.000Z',
  category: 'whatsapp',
  action: 'whatsapp.unknown_sender',
  actor: null,
  targetUser: null,
  details: { waId: '919800000001', type: 'text' },
};

const page = (results, extra = {}) => ({
  results, page: 1, totalPages: 1, totalResults: results.length, ...extra,
});

describe('AuditLogView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUsers.mockResolvedValue({ results: [] });
    getUser.mockResolvedValue({ id: ACTOR_ID, name: 'Jane Actor', email: 'jane@example.com' });
    setUrl('');
    replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation((state, title, url) => {
      realReplaceState(state, title, url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  });

  afterEach(() => {
    cleanup();
    replaceState.mockRestore();
    setUrl('');
  });

  it('renders readable labels instead of raw action enums', async () => {
    listAuditLog.mockResolvedValue(page([accessRow]));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    expect(screen.queryByText('scoped_assignment.create')).not.toBeInTheDocument();
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Developer on client scope').length).toBeGreaterThan(0);
  });

  it('renders each entry as a table row and as a labelled card for narrow screens', async () => {
    listAuditLog.mockResolvedValue(page([accessRow]));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    const card = within(screen.getByRole('list', { name: 'RBAC audit log' })).getByRole('listitem');
    const labels = within(card).getAllByRole('term').map((dt) => dt.textContent);
    expect(labels).toEqual(['Actor', 'Target', 'What changed']);
    expect(within(card).getByText('Developer on client scope')).toBeInTheDocument();
    expect(within(card).getByText('dev@example.com')).toBeInTheDocument();
  });

  it('requests the first server page with default params on a bare URL', async () => {
    listAuditLog.mockResolvedValue(page([accessRow]));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    expect(listAuditLog).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toEqual({ page: 1, limit: 50, sortBy: 'createdAt:desc' });
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads category, action, actor, sort, page and page size from the URL', async () => {
    setUrl(`?category=whatsapp&action=unknown&ticketId=web-12&actorId=${ACTOR_ID}&sortBy=createdAt:asc&page=3&limit=20`);
    listAuditLog.mockResolvedValue(page([whatsappRow], { page: 3, totalPages: 5, totalResults: 90 }));

    render(<AuditLogView />);
    await waitForAuditAction('whatsapp.unknown_sender');

    expect(lastQuery()).toEqual({
      page: 3,
      limit: 20,
      category: 'whatsapp',
      action: 'unknown',
      ticketId: 'WEB-12',
      actorId: ACTOR_ID,
      sortBy: 'createdAt:asc',
    });
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Action')).toHaveValue('unknown');
    expect(screen.getByLabelText('Ticket')).toHaveValue('WEB-12');
    expect(screen.getByLabelText('Sort')).toHaveValue('createdAt:asc');
    expect(screen.getByLabelText('Rows per page')).toHaveValue('20');
    expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Page 3 of 5')).toBeInTheDocument();
    expect(screen.getByText('Showing 41-60')).toBeInTheDocument();
    expect(screen.getByText('90 entries')).toBeInTheDocument();
  });

  it('ignores URL values the API would reject', async () => {
    setUrl('?category=nope&actorId=not-an-id&sortBy=details:asc&limit=7&page=-2');
    listAuditLog.mockResolvedValue(page([accessRow]));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    expect(lastQuery()).toEqual({ page: 1, limit: 50, sortBy: 'createdAt:desc' });
  });

  it('writes the category to the URL, resets to page 1 and refetches from the server', async () => {
    setUrl('?page=3');
    listAuditLog.mockImplementation((params) => Promise.resolve(params.category === 'policy'
      ? page([policyRow])
      : page([accessRow], { page: 3, totalPages: 4, totalResults: 160 })));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    await userEvent.click(screen.getByRole('button', { name: 'Policy' }));

    await waitForAuditAction('role_matrix.reset');
    expect(searchParam('category')).toBe('policy');
    expect(searchParam('page')).toBeNull();
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/audit-log?category=policy');
    expect(lastQuery()).toEqual({
      page: 1, limit: 50, sortBy: 'createdAt:desc', category: 'policy',
    });
    expect(screen.getByRole('button', { name: 'Policy' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('pages on the server: Next and page buttons write ?page= and replace the rows', async () => {
    listAuditLog.mockImplementation((params) => Promise.resolve(params.page === 2
      ? page([policyRow], { page: 2, totalPages: 3, totalResults: 101 })
      : page([accessRow], { page: params.page, totalPages: 3, totalResults: 101 })));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await waitForAuditAction('role_matrix.reset');
    expect(searchParam('page')).toBe('2');
    expect(lastQuery()).toEqual({ page: 2, limit: 50, sortBy: 'createdAt:desc' });
    expect(screen.queryAllByTitle('scoped_assignment.create')).toHaveLength(0);
    expect(screen.getByText('Showing 51-100')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    await waitFor(() => expect(lastQuery()).toEqual({ page: 3, limit: 50, sortBy: 'createdAt:desc' }));
    expect(searchParam('page')).toBe('3');
  });

  it('writes page size and sort to the URL and resets the page', async () => {
    setUrl('?page=2');
    listAuditLog.mockImplementation((params) => Promise.resolve(
      page([accessRow], { page: params.page, totalPages: 3, totalResults: 120 }),
    ));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '100' } });
    await waitFor(() => expect(lastQuery()).toEqual({ page: 1, limit: 100, sortBy: 'createdAt:desc' }));
    expect(searchParam('limit')).toBe('100');
    expect(searchParam('page')).toBeNull();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(searchParam('page')).toBe('2'));

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'createdAt:asc' } });
    await waitFor(() => expect(lastQuery()).toEqual({ page: 1, limit: 100, sortBy: 'createdAt:asc' }));
    expect(searchParam('sortBy')).toBe('createdAt:asc');
    expect(searchParam('page')).toBeNull();
  });

  it('offers every known action id in the Action dropdown, grouped by category', async () => {
    listAuditLog.mockResolvedValue(page([accessRow]));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    const select = screen.getByRole('combobox', { name: 'Action' });
    const values = within(select).getAllByRole('option').map((o) => o.value);
    expect(values[0]).toBe('');
    expect(within(select).getByRole('option', { name: 'All actions' })).toHaveValue('');
    expect(values.slice(1).sort()).toEqual(Object.keys(AUDIT_ACTION_LABELS).sort());
    expect(within(select).getByRole('option', { name: 'Role matrix updated' })).toHaveValue('role_matrix.update');
    expect(within(select).getByRole('group', { name: 'Tickets' })).toContainElement(
      within(select).getByRole('option', { name: 'Ticket created' }),
    );
  });

  it('sends the chosen action id exactly, resets the page, and All actions removes it', async () => {
    setUrl('?page=2');
    listAuditLog.mockImplementation((params) => Promise.resolve(params.action === 'role_matrix.reset'
      ? page([policyRow])
      : page([accessRow], { page: 2, totalPages: 2, totalResults: 60 })));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    const select = screen.getByRole('combobox', { name: 'Action' });
    await userEvent.selectOptions(select, 'role_matrix.reset');

    await waitForAuditAction('role_matrix.reset');
    expect(searchParam('action')).toBe('role_matrix.reset');
    expect(searchParam('page')).toBeNull();
    expect(lastQuery()).toEqual({
      page: 1, limit: 50, sortBy: 'createdAt:desc', action: 'role_matrix.reset',
    });
    expect(select).toHaveValue('role_matrix.reset');

    await userEvent.selectOptions(select, '');
    await waitFor(() => expect(searchParam('action')).toBeNull());
    expect(lastQuery()).toEqual({ page: 1, limit: 50, sortBy: 'createdAt:desc' });
  });

  it('filters by ticket id from the Ticket field after a pause without needing Enter', async () => {
    const ticketRow = {
      ...accessRow, id: 't1', category: 'ticket', action: 'ticket.created', ticketId: 'WEB-12', details: {},
    };
    setUrl('?page=2');
    listAuditLog.mockImplementation((params) => Promise.resolve(params.ticketId === 'WEB-12'
      ? page([ticketRow])
      : page([accessRow], { page: 2, totalPages: 2, totalResults: 60 })));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    const ticketBox = screen.getByLabelText('Ticket');
    await userEvent.type(ticketBox, 'web-12');
    expect(ticketBox).toHaveFocus();
    expect(ticketBox).toHaveValue('WEB-12');

    await waitForAuditAction('ticket.created');
    expect(searchParam('ticketId')).toBe('WEB-12');
    expect(searchParam('action')).toBeNull();
    expect(searchParam('page')).toBeNull();
    expect(lastQuery()).toEqual({
      page: 1, limit: 50, sortBy: 'createdAt:desc', ticketId: 'WEB-12',
    });
    expect(listAuditLog.mock.calls.filter(([params]) => params.ticketId)).toHaveLength(1);

    await userEvent.clear(ticketBox);
    await waitFor(() => expect(searchParam('ticketId')).toBeNull());
    await waitForAuditAction('scoped_assignment.create');
  });

  it('sends ticket and action together when both are set', async () => {
    listAuditLog.mockResolvedValue(page([accessRow]));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    await userEvent.type(screen.getByLabelText('Ticket'), 'WEB-12{Enter}');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Action' }), 'ticket.transitioned');

    await waitFor(() => expect(lastQuery()).toEqual({
      page: 1, limit: 50, sortBy: 'createdAt:desc', action: 'ticket.transitioned', ticketId: 'WEB-12',
    }));
    expect(searchParam('ticketId')).toBe('WEB-12');
    expect(searchParam('action')).toBe('ticket.transitioned');
  });

  it('restores the filtered page when back/forward changes the URL', async () => {
    listAuditLog.mockImplementation((params) => Promise.resolve(params.category === 'whatsapp'
      ? page([whatsappRow], { page: params.page, totalPages: 2, totalResults: 51 })
      : page([accessRow])));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    act(() => {
      setUrl('?category=whatsapp&page=2');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitForAuditAction('whatsapp.unknown_sender');
    expect(lastQuery()).toEqual({
      page: 2, limit: 50, sortBy: 'createdAt:desc', category: 'whatsapp',
    });
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps WhatsApp rows when a slower unfiltered response lands afterwards', async () => {
    let resolveAll;
    listAuditLog.mockImplementation(({ category }) => (category === 'whatsapp'
      ? Promise.resolve(page([whatsappRow]))
      : new Promise((resolve) => { resolveAll = resolve; })));

    render(<AuditLogView />);
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    await waitForAuditAction('whatsapp.unknown_sender');

    await act(async () => {
      resolveAll(page([accessRow]));
      await new Promise((r) => { setTimeout(r, 0); });
    });

    expect(screen.getByRole('button', { name: 'WhatsApp' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryAllByTitle('scoped_assignment.create')).toHaveLength(0);
    expect(screen.getAllByText('+919800000001').length).toBeGreaterThan(0);
  });

  it('shows an updating state instead of the previous category rows while the new tab loads', async () => {
    let resolvePolicy;
    listAuditLog.mockImplementation(({ category }) => (category === 'policy'
      ? new Promise((resolve) => { resolvePolicy = resolve; })
      : Promise.resolve(page([accessRow]))));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    await userEvent.click(screen.getByRole('button', { name: 'Policy' }));

    expect(screen.queryAllByTitle('scoped_assignment.create')).toHaveLength(0);
    expect(screen.getByRole('status', { name: 'Updating audit log' })).toBeInTheDocument();

    await act(async () => { resolvePolicy(page([policyRow])); });
    await waitForAuditAction('role_matrix.reset');
  });

  it('shows the category empty state after switching to a category with no rows', async () => {
    listAuditLog.mockImplementation(({ category }) => Promise.resolve(
      category === 'whatsapp' ? page([]) : page([accessRow]),
    ));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));

    await waitFor(() => {
      expect(screen.getByText('No WhatsApp entries yet')).toBeInTheDocument();
    });
    expect(screen.queryAllByTitle('scoped_assignment.create')).toHaveLength(0);
  });

  it('shows a no-match state for combined filters and clears them from the URL', async () => {
    setUrl('?category=policy&action=zzz&sortBy=createdAt:asc');
    listAuditLog.mockImplementation(({ action }) => Promise.resolve(action ? page([]) : page([accessRow])));

    render(<AuditLogView />);

    await waitFor(() => {
      expect(screen.getByText('No entries match these filters')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitForAuditAction('scoped_assignment.create');
    expect(window.location.search).toBe('?sortBy=createdAt%3Aasc');
  });

  it('shows an empty state when no entries exist', async () => {
    listAuditLog.mockResolvedValue(page([]));

    render(<AuditLogView />);

    await waitFor(() => {
      expect(screen.getByText('No audit entries yet')).toBeInTheDocument();
    });
  });

  it('moves a page past the end back to the last real page', async () => {
    setUrl('?page=9');
    listAuditLog.mockImplementation((params) => Promise.resolve(params.page > 2
      ? page([], { page: params.page, totalPages: 2, totalResults: 60 })
      : page([accessRow], { page: params.page, totalPages: 2, totalResults: 60 })));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    expect(searchParam('page')).toBe('2');
    expect(lastQuery()).toEqual({ page: 2, limit: 50, sortBy: 'createdAt:desc' });
  });

  it('uses people pickers for actor and target instead of raw id fields', async () => {
    listAuditLog.mockResolvedValue(page([accessRow]));

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    expect(screen.queryByText(/user id/i)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Actor' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Target' })).toBeInTheDocument();
  });

  it('applies actor filter from people search selection and writes it to the URL', async () => {
    listAuditLog.mockResolvedValue(page([accessRow]));
    listUsers.mockResolvedValue({
      results: [{ id: ACTOR_ID, name: 'Jane Actor', email: 'jane@example.com' }],
    });

    render(<AuditLogView />);
    await waitForAuditAction('scoped_assignment.create');

    const actorBox = screen.getByRole('combobox', { name: 'Actor' });
    await userEvent.click(actorBox);
    await userEvent.type(actorBox, 'jane');

    await waitFor(() => {
      expect(listUsers).toHaveBeenCalled();
    }, { timeout: 2000 });

    await userEvent.click(screen.getByRole('option', { name: /jane actor/i }));

    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ actorId: ACTOR_ID, page: 1 }));
    });
    expect(searchParam('actorId')).toBe(ACTOR_ID);
    expect(screen.getByLabelText('Clear Actor filter')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });
});
