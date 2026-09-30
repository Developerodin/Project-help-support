import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { requestModuleView } from '../../lib/assistant-ticket-filters.js';
import TicketModuleGroups, { groupTicketsByModule, groupTicketsByPage, laneCounts } from './ticket-module-groups.jsx';
import { listAllTickets } from '../../lib/list-all-tickets.js';

const listTickets = vi.fn();
vi.mock('@/shared/api/tickets.js', () => ({ listTickets: (...args) => listTickets(...args) }));

const summary = (groups) => groups.map((g) => [g.module, g.tickets.map((t) => t.ticketId)]);

describe('groupTicketsByModule', () => {
  const tickets = [
    { ticketId: 'A-3', module: 'Payroll' },
    { ticketId: 'A-2' },
    { ticketId: 'A-1', module: 'Attendance' },
    { ticketId: 'A-0', module: 'Payroll ' },
    { ticketId: 'A-9', module: '', blocked: true },
    { ticketId: 'A-8', module: '', blocked: true },
  ];

  it('A–Z keeps order inside a group and puts No module last', () => {
    expect(summary(groupTicketsByModule(tickets))).toEqual([
      ['Attendance', ['A-1']],
      ['Payroll', ['A-3', 'A-0']],
      ['No module', ['A-2', 'A-9', 'A-8']],
    ]);
  });

  it('needs-attention puts the most blocked/overdue module first', () => {
    expect(groupTicketsByModule(tickets, 'urgency').map((g) => g.module))
      .toEqual(['No module', 'Payroll', 'Attendance']);
  });
});

describe('TicketModuleGroups', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    ticketId: `A-${i}`, title: `Ticket ${i}`, module: 'ATS', status: 'pending', priority: i === 0 ? 'Urgent' : 'Medium',
  }));

  it('collapses a module, remembers it, and expands all again', () => {
    window.localStorage.clear();
    render(<TicketModuleGroups onOpen={() => {}} tickets={many} />);
    const head = screen.getByRole('button', { name: /ATS/ });
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('region', { name: 'ATS' }).classList.contains('is-collapsed')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem('tickets.collapsedModules'))).toEqual(['ATS']);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(head.getAttribute('aria-expanded')).toBe('true');
  });

  it('applies the assistant\'s steps in order: collapse all, expand one, show more, reorder', () => {
    window.localStorage.clear();
    const tickets = [
      ...many,
      { ticketId: 'B-1', title: 'Payroll bug', module: 'Payroll', status: 'pending', blocked: true },
    ];
    render(<TicketModuleGroups onOpen={() => {}} tickets={tickets} />);
    act(() => requestModuleView([
      { type: 'module_view', action: 'collapse', modules: null, order: null },
      { type: 'module_view', action: 'expand', modules: ['ats'], order: null },
      { type: 'module_view', action: 'show_all', modules: ['ATS'], order: 'attention' },
    ]));

    expect(screen.getByRole('button', { name: /^ATS/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /^Payroll/ }).getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('tickets.collapsedModules'))).toEqual(['Payroll']);
    expect(screen.getByText('Ticket 6')).toBeTruthy(); // every ATS ticket, not the first five
    expect(screen.getByRole('button', { name: 'Needs attention' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('collapses all but the excepted module in one step, opening it if it was shut', () => {
    window.localStorage.setItem('tickets.collapsedModules', JSON.stringify(['Master Catalog']));
    const tickets = [
      ...many,
      { ticketId: 'C-1', title: 'Catalog bug', module: 'Master Catalog', status: 'pending' },
    ];
    render(<TicketModuleGroups onOpen={() => {}} tickets={tickets} />);
    act(() => requestModuleView([
      { type: 'module_view', action: 'collapse', modules: null, order: null, except: ['master catalog'] },
    ]));

    expect(screen.getByRole('button', { name: /^Master Catalog/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /^ATS/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('waits for the full list before applying steps, and remembers collapse per user and project', () => {
    window.localStorage.clear();
    const { rerender } = render(<TicketModuleGroups onOpen={() => {}} tickets={many} loaded={false} storageScope="u1:p1" />);
    act(() => requestModuleView([{ type: 'module_view', action: 'collapse', modules: null, order: null }]));
    expect(screen.getByRole('button', { name: /^ATS/ }).getAttribute('aria-expanded')).toBe('true');

    rerender(<TicketModuleGroups onOpen={() => {}} tickets={many} loaded storageScope="u1:p1" />);
    expect(screen.getByRole('button', { name: /^ATS/ }).getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('tickets.collapsedModules:u1:p1'))).toEqual(['ATS']);
    expect(window.localStorage.getItem('tickets.collapsedModules')).toBeNull();
  });

  it('takes steps queued before it mounted (the assistant opened the view for them)', () => {
    window.localStorage.clear();
    requestModuleView([{ type: 'module_view', action: 'collapse', modules: ['ATS'], order: null }]);
    render(<TicketModuleGroups onOpen={() => {}} tickets={many} />);
    expect(screen.getByRole('button', { name: /^ATS/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('previews 5 tickets, shows the rest on demand, and hides the Medium chip', () => {
    window.localStorage.clear();
    render(<TicketModuleGroups onOpen={() => {}} tickets={many} canCreate />);
    expect(screen.queryByText('Ticket 6')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(screen.getByText('Ticket 6')).toBeTruthy();
    expect(screen.getByText('Urgent')).toBeTruthy();
    expect(screen.queryByText('Medium')).toBeNull();
    expect(screen.getByRole('link', { name: 'New ticket in ATS' }).getAttribute('href'))
      .toBe('/tickets/new?module=ATS');
  });
});

describe('listAllTickets', () => {
  it('walks pages until totalPages and flags truncation at the cap', async () => {
    listTickets.mockReset().mockImplementation(({ page }) => Promise.resolve({
      results: [{ ticketId: `T-${page}` }], totalPages: 2, totalResults: 2,
    }));
    const res = await listAllTickets({ q: 'x' });
    expect(res.results.map((t) => t.ticketId)).toEqual(['T-1', 'T-2']);
    expect(res.truncated).toBe(false);

    listTickets.mockImplementation(() => Promise.resolve({ results: [{}], totalPages: 50 }));
    expect((await listAllTickets({})).truncated).toBe(true);
    expect(listTickets).toHaveBeenLastCalledWith({ page: 10, limit: 100 }, { signal: undefined });
  });
});

describe('TicketModuleGroups card click', () => {
  it('toggles on a click anywhere on the card, but not on a ticket', () => {
    window.localStorage.clear();
    const onOpen = vi.fn();
    render(
      <TicketModuleGroups
        onOpen={onOpen}
        tickets={[{ ticketId: 'A-1', title: 'One', module: 'ATS', status: 'pending' }]}
      />,
    );
    const head = screen.getByRole('button', { name: /ATS/ });
    fireEvent.click(screen.getByRole('region', { name: 'ATS' }));
    expect(head.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('region', { name: 'ATS' }));
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Open ticket A-1/ }));
    expect(onOpen).toHaveBeenCalledWith('A-1');
    expect(head.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('module card summary', () => {
  const tickets = [
    { ticketId: 'A-1', title: 'One', module: 'ATS', status: 'pending', blocked: true },
    { ticketId: 'A-2', title: 'Two', module: 'ATS', status: 'ready_qa' },
    { ticketId: 'A-3', title: 'Three', module: 'ATS', status: 'closed' },
    { ticketId: 'L-1', title: 'Four', module: 'Logs', status: 'closed' },
  ];

  it('counts tickets per board lane', () => {
    expect(laneCounts(tickets.slice(0, 3)).map((l) => [l.key, l.count])).toEqual([
      ['intake', 1], ['development', 0], ['qa', 1], ['release', 0], ['done', 1],
    ]);
  });

  it('leads with open tickets, labels the stage bar, and quiets healthy modules', () => {
    window.localStorage.clear();
    render(<TicketModuleGroups onOpen={() => {}} tickets={tickets} />);
    const ats = screen.getByRole('region', { name: 'ATS' });
    expect(ats.querySelector('.mg-open').textContent).toBe('2 open');
    expect(screen.getByRole('img', { name: 'By stage: Intake 1, QA 1, Done 1' })).toBeTruthy();
    expect(ats.classList.contains('is-calm')).toBe(false);
    expect(screen.getByRole('region', { name: 'Logs' }).classList.contains('is-calm')).toBe(true);
    expect(screen.getByText('4 tickets')).toBeTruthy();
    expect(screen.getByText('1 blocked', { selector: '.mg-summary-alarm' })).toBeTruthy();
  });
});

describe('page sub-groups', () => {
  it('groups by page A–Z with page-less tickets last', () => {
    expect(groupTicketsByPage([
      { ticketId: '1', page: 'Chats' }, { ticketId: '2' }, { ticketId: '3', page: 'Calls' }, { ticketId: '4', page: 'Chats ' },
    ]).map((g) => [g.page, g.tickets.map((t) => t.ticketId)])).toEqual([
      ['Calls', ['3']], ['Chats', ['1', '4']], ['', ['2']],
    ]);
  });

  it('labels pages (unnamed as Other) and skips labels when no ticket has a page', () => {
    window.localStorage.clear();
    const { unmount } = render(
      <TicketModuleGroups
        onOpen={() => {}}
        tickets={[
          { ticketId: 'A-1', title: 'One', module: 'ATS', page: 'Jobs', status: 'pending' },
          { ticketId: 'A-2', title: 'Two', module: 'ATS', status: 'pending' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Page: Jobs' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Page: Other' })).toBeTruthy();
    unmount();
    render(
      <TicketModuleGroups
        onOpen={() => {}}
        tickets={[{ ticketId: 'B-1', title: 'One', module: 'Logs', status: 'pending' }]}
      />,
    );
    expect(screen.queryByRole('group', { name: /^Page:/ })).toBeNull();
  });
});
