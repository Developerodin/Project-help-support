import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const getAssistantStatus = vi.fn();
const sendAssistantMessage = vi.fn();
const createTicket = vi.fn();
const getTicket = vi.fn();
const transitionTicket = vi.fn();

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  // Read from the real address, so tests set it with history.replaceState and re-render.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// Who is signed in; tests swap this to simulate sign-in changes in the same tab.
const refreshUser = vi.fn(() => Promise.resolve());
const auth = { user: { id: 'u1', name: 'Ada' }, refreshUser };
vi.mock('@/shared/contexts/auth-context.jsx', () => ({ useAuth: () => auth }));
const publish = vi.fn();
vi.mock('@/shared/contexts/realtime-context.jsx', () => ({ useRealtime: () => ({ publish }) }));
const setActiveProjectId = vi.fn();
vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: () => ({ activeProject: { key: 'WEB' }, setActiveProjectId }),
}));

vi.mock('@/shared/api/assistant.js', () => ({
  getAssistantStatus: (...args) => getAssistantStatus(...args),
  sendAssistantMessage: (...args) => sendAssistantMessage(...args),
  // Typed chat streams; one mock stands in for both, as they resolve the same.
  streamAssistantMessage: (...args) => sendAssistantMessage(...args),
  speakText: vi.fn(),
  transcribeAudio: vi.fn(),
}));
const resolveAttachmentDownloadUrl = vi.fn();
const createProject = vi.fn();
const patchClient = vi.fn();
const uploadClientLogo = vi.fn();
vi.mock('@/shared/api/projects.js', () => ({ createProject: (...args) => createProject(...args) }));
vi.mock('@/shared/api/teams.js', () => ({ createTeam: vi.fn() }));
vi.mock('@/shared/api/clients.js', () => ({
  createClient: vi.fn(),
  patchClient: (...args) => patchClient(...args),
  uploadClientLogo: (...args) => uploadClientLogo(...args),
}));
const updateNotificationPrefs = vi.fn();
const resetNotificationPrefs = vi.fn();
vi.mock('@/shared/api/users.js', () => ({
  updateNotificationPrefs: (...args) => updateNotificationPrefs(...args),
  resetNotificationPrefs: (...args) => resetNotificationPrefs(...args),
}));
const mutateNotifications = vi.fn();
vi.mock('@/shared/lib/notification-swr.js', () => ({ mutateNotifications: (...args) => mutateNotifications(...args) }));
const downloadReport = vi.fn();
vi.mock('@/shared/lib/report-document.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadReport: (...args) => downloadReport(...args),
}));
const addComment = vi.fn();
const patchTicket = vi.fn();
const assignTicket = vi.fn();
const uploadAttachments = vi.fn();
const watchTicket = vi.fn();
vi.mock('@/shared/api/tickets.js', () => ({
  addComment: (...args) => addComment(...args),
  assignTicket: (...args) => assignTicket(...args),
  uploadAttachments: (...args) => uploadAttachments(...args),
  watchTicket: (...args) => watchTicket(...args),
  unwatchTicket: vi.fn(),
  setBlocked: vi.fn(),
  clearBlocked: vi.fn(),
  resolveAttachmentDownloadUrl: (...args) => resolveAttachmentDownloadUrl(...args),
  createTicket: (...args) => createTicket(...args),
  getTicket: (...args) => getTicket(...args),
  patchTicket: (...args) => patchTicket(...args),
  transitionTicket: (...args) => transitionTicket(...args),
}));

const {
  default: AssistantWidget, splitTicketIds, describeAction, matchVoiceCommand, isTalkKey, MessageText, historyText, currentPage, TicketDraftFields,
} = await import('./assistant-widget.jsx');

const say = (text) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message the assistant' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};

describe('helpers', () => {
  it('splits ticket ids out of text', () => {
    expect(splitTicketIds('WEB-55 and ATS-7 are late.')).toEqual([
      { ticketId: 'WEB-55' }, ' and ', { ticketId: 'ATS-7' }, ' are late.',
    ]);
    expect(splitTicketIds('nothing here')).toEqual(['nothing here']);
  });

  it('recognises spoken confirm, cancel and stop, and nothing else', () => {
    expect(['Yes.', 'confirm it', 'Go ahead', 'okay please'].map(matchVoiceCommand)).toEqual(['confirm', 'confirm', 'confirm', 'confirm']);
    expect(['No', 'cancel', 'never mind'].map(matchVoiceCommand)).toEqual(['cancel', 'cancel', 'cancel']);
    expect(['Stop.', "that's all", 'Goodbye!'].map(matchVoiceCommand)).toEqual(['stop', 'stop', 'stop']);
    expect(matchVoiceCommand('yes, and also change the priority')).toBeNull();
    expect(matchVoiceCommand('stop the deploy on WEB-5')).toBeNull();
    expect(['Haan', 'theek hai', 'Achha.', 'haan ji', 'post kar do', 'हाँ'].map(matchVoiceCommand)).toEqual(Array(6).fill('confirm'));
    expect(['Nahi', 'rehne do', 'mat karo', 'नहीं'].map(matchVoiceCommand)).toEqual(Array(4).fill('cancel'));
    expect(matchVoiceCommand('haan but change the title')).toBeNull();
  });

  it('push-to-talk is plain Space, but never while typing or on a control Space would press', () => {
    const on = (html) => {
      document.body.innerHTML = html;
      return document.body.querySelector('#t');
    };
    const key = (target, over = {}) => ({ code: 'Space', target, ...over });
    expect(isTalkKey(key(on('<main id="t"><p>page</p></main>')))).toBe(true);
    expect(isTalkKey(key(on('<main><p id="t">text</p></main>')))).toBe(true);
    expect(isTalkKey(key(on('<input id="t">')))).toBe(false);
    expect(isTalkKey(key(on('<textarea id="t"></textarea>')))).toBe(false);
    expect(isTalkKey(key(on('<div contenteditable="true"><span id="t">x</span></div>')))).toBe(false);
    expect(isTalkKey(key(on('<button><span id="t">Save</span></button>')))).toBe(false);
    expect(isTalkKey(key(on('<a href="/x" id="t">link</a>')))).toBe(false);
    expect(isTalkKey(key(on('<main id="t"></main>'), { ctrlKey: true }))).toBe(false);
    expect(isTalkKey(key(on('<main id="t"></main>'), { shiftKey: true }))).toBe(false);
    expect(isTalkKey({ code: 'KeyA', target: document.body })).toBe(false);
    document.body.innerHTML = '';
  });

  it('describes a stage change in stage labels', () => {
    expect(describeAction({ type: 'stage_change', ticketId: 'WEB-5', from: 'ready_qa', to: 'closed' }))
      .toEqual({ heading: 'Move WEB-5', rows: [['Stage', 'Ready for QA → Closed']] });
  });
});

describe('AssistantWidget', () => {
  beforeEach(() => {
    [getAssistantStatus, sendAssistantMessage, createTicket, getTicket, transitionTicket, push,
      resolveAttachmentDownloadUrl, createProject, patchClient, uploadClientLogo,
      addComment, assignTicket, uploadAttachments, watchTicket, patchTicket].forEach((fn) => fn.mockReset());
    window.localStorage.clear();
    window.sessionStorage.clear();
    auth.user = { id: 'u1', name: 'Ada' };
  });

  it('stays hidden when the server has no assistant', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: false });
    render(<AssistantWidget />);
    await waitFor(() => expect(getAssistantStatus).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Open assistant' })).toBeNull();
  });

  it('a notification settings card shows each change and saves only those, then refreshes the user', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Drafted it.',
      actions: [{
        id: 'n1', type: 'notification_settings',
        settings: [
          { event: 'TICKET_COMMENTED', label: 'Ticket commented', email: { from: true, to: false } },
          { event: 'TICKET_CLOSED', label: 'Ticket closed', inApp: { from: true, to: false }, email: { from: true, to: false } },
        ],
      }],
    });
    updateNotificationPrefs.mockResolvedValue({});

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('No emails for comments, and nothing for closed tickets');

    expect(await screen.findByText('Change notifications')).toBeTruthy();
    expect(screen.getByText('Email on → off')).toBeTruthy();
    expect(screen.getByText('In app on → off, Email on → off')).toBeTruthy();
    expect(updateNotificationPrefs).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Updated your notification settings.');
    expect(updateNotificationPrefs).toHaveBeenCalledWith({
      inApp: { TICKET_CLOSED: false }, email: { TICKET_COMMENTED: false, TICKET_CLOSED: false },
    });
    expect(resetNotificationPrefs).not.toHaveBeenCalled();
    expect(refreshUser).toHaveBeenCalled();
    expect(mutateNotifications).toHaveBeenCalled();
  });

  it('a report shows as a card to download, and asking to download it saves the latest report', async () => {
    const report = {
      project: { key: 'WEB', name: 'Web App' }, from: '2026-09-16', to: '2026-09-23',
      totals: { tickets: 5, open: 4, created: 2, finished: 1, overdue: 1, blocked: 0 },
      by_stage: [], bottleneck: null, lead_time_median_hours: null, cycle_time_median_hours: null,
      created_tickets: [], finished_tickets: [], blocked_tickets: [], open_by_owner: [],
      overdue_tickets: [{ id: 'WEB-4', title: 'Inbox never loads', stage: 'Pending', priority: 'High', owner: 'Riya', due: '2026-09-20' }],
    };
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage
      .mockResolvedValueOnce({ reply: 'A quiet week; WEB-4 is late.', actions: [{ id: 'r1', type: 'report', report }] })
      .mockResolvedValueOnce({ reply: 'Downloading it.', actions: [{ id: 'd1', type: 'report_download' }] });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Weekly report for WEB');

    const card = await screen.findByRole('region', { name: 'Web App (WEB) report' });
    expect(card.textContent).toContain('16 Sep – 23 Sep 2026');
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download document' }));
    expect(downloadReport).toHaveBeenLastCalledWith(report, 'A quiet week; WEB-4 is late.');

    say('Can I download it?');
    await screen.findByText('Downloading it.');
    expect(downloadReport).toHaveBeenCalledTimes(2);
    expect(downloadReport).toHaveBeenLastCalledWith(report, 'A quiet week; WEB-4 is late.');
    expect(sendAssistantMessage.mock.calls[1][0][1].notes).toContain('[Report shown: Web App (WEB) report, 2026-09-16 to 2026-09-23]');
  });

  it('chats, links ticket ids, and applies a draft only when confirmed', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Drafted it, see WEB-4 for the related bug.',
      actions: [{
        id: 'a1', type: 'create_ticket', projectKey: 'WEB',
        body: { project: 'p1', title: 'Inbox never loads', description: 'Spins forever.', module: 'Chats' },
      }],
    });
    createTicket.mockResolvedValue({ ticketId: 'WEB-93' });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('File a bug');

    expect(await screen.findByRole('link', { name: 'WEB-4' })).toHaveProperty('href', expect.stringContaining('/tickets?ticket=WEB-4'));
    expect(sendAssistantMessage.mock.calls[0][0]).toEqual([{ role: 'user', content: 'File a bug' }]);
    expect(sendAssistantMessage.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(sendAssistantMessage.mock.calls[0][1].mode).toBeUndefined();
    expect(screen.getByText('New ticket in WEB')).toBeTruthy();
    expect(createTicket).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('link', { name: 'WEB-93' });
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ title: 'Inbox never loads', module: 'Chats' }));
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('lets the user correct a drafted ticket before confirming, and submits the edits', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Here is the draft.',
      actions: [{
        id: 'd1', type: 'create_ticket', projectKey: 'WEB',
        modules: [{ label: 'Chats', pages: ['Inbox', 'Calls'] }, { label: 'ATS', pages: ['Jobs'] }],
        body: {
          project: 'p1', title: 'Inbox never loads', description: 'Spins forever on open.',
          module: 'Chats', page: 'Inbox', category: 'Bug', severity: 'Major', priority: 'Medium', environment: 'Staging',
        },
      }],
    });
    createTicket.mockResolvedValue({ ticketId: 'WEB-94' });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Log a bug');
    await screen.findByText('New ticket in WEB');

    fireEvent.change(screen.getByRole('combobox', { name: 'Module' }), { target: { value: 'ATS' } });
    expect(screen.getByRole('combobox', { name: 'Page' }).value).toBe('Jobs');
    fireEvent.change(screen.getByRole('combobox', { name: 'Severity' }), { target: { value: 'Critical' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'x' } });
    expect(screen.getByRole('button', { name: 'Confirm' }).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Jobs page never loads' } });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Done');
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Jobs page never loads', module: 'ATS', page: 'Jobs', severity: 'Critical', priority: 'Medium',
    }));
  });

  it('keeps a failed stage change on screen with the reason and a retry', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Ready to move it.',
      actions: [{ id: 'a2', type: 'stage_change', ticketId: 'WEB-5', from: 'ready_qa', to: 'closed' }],
    });
    getTicket.mockResolvedValue({ revision: 3 });
    transitionTicket.mockRejectedValue(Object.assign(new Error('Requires permission'), { status: 403, code: 'FORBIDDEN' }));

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the board' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(transitionTicket).toHaveBeenCalledWith('WEB-5', { to: 'closed', revision: 3 });
    expect(screen.getByRole('alert').textContent).toMatch(/permission/i);
  });

  it('answers the one waiting draft when the user says "yes", without asking the model', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Move it?',
      actions: [{ id: 'a3', type: 'stage_change', ticketId: 'WEB-7', from: 'ready_qa', to: 'qa_approved' }],
    });
    getTicket.mockResolvedValue({ revision: 1 });
    transitionTicket.mockResolvedValue({});

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Approve WEB-7');
    await screen.findByText('Move WEB-7');
    say('Yes.');

    await screen.findByText('Done');
    expect(transitionTicket).toHaveBeenCalledWith('WEB-7', { to: 'qa_approved', revision: 1 });
    expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
  });

  it('navigates right away and shows no card for it', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Opened overdue tickets.',
      actions: [{ id: 'n1', type: 'navigate', href: '/tickets?overdue=1', label: 'Tickets' }],
    });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Show overdue tickets');

    await screen.findByText('Opened overdue tickets.');
    expect(push).toHaveBeenCalledWith('/tickets?overdue=1');
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('scrolls the page right away and shows no card for it', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Scrolled down.',
      actions: [{ id: 'sc1', type: 'scroll', direction: 'bottom' }],
    });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Scroll to the bottom');

    await screen.findByText('Scrolled down.');
    expect(scrollTo).toHaveBeenCalledWith({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    scrollTo.mockRestore();
  });

  it('pages the list it is on, keeping the other query params', async () => {
    window.history.replaceState(null, '', '/tickets?stage=qa&page=2');
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Next page.',
      actions: [{ id: 'p1', type: 'change_page', direction: 'next' }],
    });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Next page');

    await screen.findByText('Next page.');
    expect(push).toHaveBeenCalledWith('/tickets?stage=qa&page=3');
    window.history.replaceState(null, '', '/');
  });

  it('does not page a screen that has no paged list', async () => {
    window.history.replaceState(null, '', '/tickets/analytics');
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Going to page 2.',
      actions: [{ id: 'p2', type: 'change_page', direction: 'number', page: 2 }],
    });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Go to page 2');

    await screen.findByText('Paging works on the Tickets, People, Projects and Teams lists.');
    expect(push).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
  });

  it('searches the People page, keeping its other filters and going back to page 1', async () => {
    window.history.replaceState(null, '', '/users?status=active&page=3');
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Searched for Prakhar.',
      actions: [{ id: 'pf1', type: 'people_filters', search: 'Prakhar Sharma', role: 'any' }],
    });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Search him in the filters');

    await screen.findByText('Searched for Prakhar.');
    expect(push).toHaveBeenCalledWith('/users?status=active&search=Prakhar+Sharma');
    window.history.replaceState(null, '', '/');
  });

  it('sets another page\'s filters in its URL, keeping the rest and going back to page 1', async () => {
    window.history.replaceState(null, '', '/teams?status=archived&page=2');
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Showing global teams.',
      actions: [{ id: 'pg1', type: 'page_filters', path: '/teams', params: { scope: 'global', search: null } }],
    });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Show global teams');

    await screen.findByText('Showing global teams.');
    expect(push).toHaveBeenCalledWith('/teams?status=archived&scope=global');
    window.history.replaceState(null, '', '/');
  });

  it('opens another page with only the asked-for filters when the user is elsewhere', async () => {
    window.history.replaceState(null, '', '/tickets?stage=qa');
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Showing unread.',
      actions: [{ id: 'pg2', type: 'page_filters', path: '/notifications', params: { unread: '1' } }],
    });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Show unread notifications');

    await screen.findByText('Showing unread.');
    expect(push).toHaveBeenCalledWith('/notifications?unread=1');
    window.history.replaceState(null, '', '/');
  });

  it('switches to the module view for module steps and hands the steps over', async () => {
    window.history.replaceState(null, '', '/tickets?stage=qa');
    const onFilters = vi.fn();
    const onSteps = vi.fn();
    window.addEventListener('assistant:ticket-filters', onFilters);
    window.addEventListener('assistant:module-view', onSteps);
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Collapsed every module.',
      actions: [{ id: 'm1', type: 'module_view', action: 'collapse', modules: null, order: null }],
    });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Open the module view and collapse all the modules');

    await screen.findByText('Collapsed every module.');
    expect(onSteps).toHaveBeenCalledTimes(1);
    expect(onFilters).toHaveBeenCalledTimes(1); // the view switch, merged into one filters request
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    window.removeEventListener('assistant:ticket-filters', onFilters);
    window.removeEventListener('assistant:module-view', onSteps);
    window.history.replaceState(null, '', '/');
  });

  it('builds one address per turn: filters then paging land together', async () => {
    window.history.replaceState(null, '', '/teams?page=3');
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Archived teams, next page.',
      actions: [
        { id: 'f1', type: 'page_filters', path: '/teams', params: { status: 'archived' } },
        { id: 'p1', type: 'change_page', direction: 'next' },
      ],
    });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Show archived teams, next page');

    await screen.findByText('Archived teams, next page.');
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/teams?status=archived&page=2'); // filters start at page 1
    window.history.replaceState(null, '', '/');
  });

  it('shows what the app could not do and tells the next turn', async () => {
    window.history.replaceState(null, '', '/tickets/board');
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage
      .mockResolvedValueOnce({ reply: 'Moved to the next page.', actions: [{ id: 'p2', type: 'change_page', direction: 'next' }] })
      .mockResolvedValueOnce({ reply: 'Sorry about that.', actions: [] });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Next page');
    expect(await screen.findByText('Paging works on the Tickets, People, Projects and Teams lists.')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();

    say('Did it work?');
    await screen.findByText('Sorry about that.');
    const history = sendAssistantMessage.mock.calls[1][0];
    const reply = history.find((message) => message.content.startsWith('Moved to the next page.'));
    expect(reply.notes).toContain('[Not done, the app said: Paging works on the Tickets, People, Projects and Teams lists.]');
    window.history.replaceState(null, '', '/');
  });

  it('notes what it did in the history, and scrolls only after navigating', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage
      .mockResolvedValueOnce({
        reply: 'Opened the board.',
        actions: [
          { id: 'n1', type: 'navigate', href: '/tickets/board', label: 'Board' },
          { id: 's1', type: 'scroll', direction: 'bottom' },
        ],
      })
      .mockResolvedValueOnce({ reply: 'Ok.', actions: [] });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Open the board and scroll to the bottom');
    await screen.findByText('Opened the board.');
    expect(push).toHaveBeenCalledWith('/tickets/board');
    expect(scrollTo).not.toHaveBeenCalled(); // waits for the board, not the old page

    say('Thanks');
    await screen.findByText('Ok.');
    const reply = sendAssistantMessage.mock.calls[1][0].find((message) => message.content.startsWith('Opened the board.'));
    expect(reply.notes).toContain('[Done in the app: opened Board; scrolled bottom]');
    scrollTo.mockRestore();
  });

  it('switches project right away, and tells the server which project is showing', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Switched to Mobile.',
      actions: [{ id: 's1', type: 'switch_project', projectId: 'p2', label: 'MOB Mobile' }],
    });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Switch to mobile');

    await screen.findByText('Switched to Mobile.');
    expect(setActiveProjectId).toHaveBeenCalledWith('p2');
    expect(sendAssistantMessage.mock.calls.at(-1)[1].page.project).toBe('WEB');
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('filters go to the Tickets page itself (opening it if needed), with no card', async () => {
    const { takeTicketFilters } = await import('@/shared/lib/assistant-ticket-filters.js');
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({
      reply: 'Showing every stage now.',
      actions: [{ id: 'f1', type: 'ticket_filters', filters: { status: '' } }],
    });
    window.history.replaceState({}, '', '/tickets/board');
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('pending filter hata do');

    await screen.findByText('Showing every stage now.');
    expect(takeTicketFilters()).toMatchObject({ type: 'ticket_filters', filters: { status: '' } });
    expect(push).toHaveBeenCalledWith('/tickets');
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    window.history.replaceState({}, '', '/');
  });

  it('explains when the browser cannot record', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voice mode' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't supported/);
    expect(screen.getByRole('button', { name: 'Voice mode' }).getAttribute('aria-pressed')).toBe('false');
  });

  describe('hold Space to talk', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    const openedByHold = async (holdMs, target = document.body) => {
      getAssistantStatus.mockResolvedValue({ enabled: true });
      render(<AssistantWidget />);
      await screen.findByRole('button', { name: 'Open assistant' });
      fireEvent.keyDown(target, { code: 'Space', key: ' ' });
      await act(async () => { vi.advanceTimersByTime(holdMs); });
      fireEvent.keyUp(target, { code: 'Space', key: ' ' });
      await act(async () => {});
      return screen.queryByRole('dialog', { name: 'Assistant' }) !== null;
    };

    it('a hold opens the assistant and starts listening', async () => {
      expect(await openedByHold(400)).toBe(true);
      // jsdom has no microphone, so the attempt surfaces as the unsupported message.
      expect((await screen.findByRole('alert')).textContent).toMatch(/isn't supported/);
    });

    it('a quick tap does nothing', async () => {
      expect(await openedByHold(100)).toBe(false);
    });

    it('holding Space while typing in a field does nothing', async () => {
      const field = document.createElement('input');
      document.body.appendChild(field);
      expect(await openedByHold(400, field)).toBe(false);
      field.remove();
    });
  });

  const replyWith = async (actions) => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({ reply: 'Here you go.', actions });
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('go');
    await screen.findByText('Here you go.');
  };

  it('offers ticket files as buttons that open a fresh signed link in a new tab', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab);
    resolveAttachmentDownloadUrl.mockResolvedValue('https://files.example/screen.png?sig=1');
    await replyWith([{ id: 'f1', type: 'attachment', ticketId: 'WEB-5', attachmentId: 'a9', name: 'screen.png' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Open screen.png' }));
    await waitFor(() => expect(tab.location.href).toBe('https://files.example/screen.png?sig=1'));
    expect(resolveAttachmentDownloadUrl).toHaveBeenCalledWith('WEB-5', 'a9');
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('project draft: a bad key blocks confirm; the edited draft is what gets created', async () => {
    createProject.mockResolvedValue({ name: 'Acme Portal', key: 'ACP' });
    await replyWith([{
      id: 'p1', type: 'create_project', clientName: 'Acme',
      body: { clientId: 'c1', name: 'Acme Portal', modules: [{ label: 'Billing', pages: [{ label: 'Invoices' }] }] },
    }]);
    expect(screen.getByText(/Billing \(Invoices\)/)).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Key' }), { target: { value: '1x' } });
    expect(screen.getByRole('button', { name: 'Confirm' }).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Key' }), { target: { value: 'acp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByText('Created project Acme Portal (ACP).');
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'c1', key: 'ACP' }));
  });

  it('brand draft: renames the client and uploads the chosen logo', async () => {
    patchClient.mockResolvedValue({});
    uploadClientLogo.mockResolvedValue({});
    await replyWith([{
      id: 'b1', type: 'client_brand', clientId: 'c1', currentName: 'Acme', name: 'Acme Corp', hasLogo: false,
    }]);

    const logo = new File(['png'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Logo (optional)'), { target: { files: [logo] } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByText('Updated the brand for Acme Corp.');
    expect(patchClient).toHaveBeenCalledWith('c1', { name: 'Acme Corp' });
    expect(uploadClientLogo).toHaveBeenCalledWith('c1', logo);
  });

  it('formats replies (lists, bold, ticket links) without ever rendering HTML', () => {
    const { container } = render(<MessageText text={'Two tickets:\n- **WEB-5** is blocked\n- WEB-6 is late\n<img src=x onerror=alert(1)>'} />);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('strong a').textContent).toBe('WEB-5');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('tells the model about its drafts, as edited, on the next turn', () => {
    const text = historyText({
      role: 'assistant',
      content: 'Here is the draft.',
      actions: [{
        type: 'create_ticket', projectKey: 'WEB', status: 'pending',
        body: { title: 'Inbox broken', description: 'Only checking the assistant works', module: 'Chats', page: 'Inbox' },
      }],
    });
    expect(text).toContain('Here is the draft.');
    expect(text).toContain('[Draft "New ticket in WEB"');
    expect(text).toContain('Details: Only checking the assistant works');
    expect(text).toContain('Status: waiting for the user to confirm');
  });

  it('a revised draft replaces the older card, leaving one thing to confirm', async () => {
    const draft = (title) => ({
      reply: `Draft: ${title}`,
      actions: [{
        id: title, type: 'create_ticket', projectKey: 'WEB',
        body: { project: 'p1', title, description: 'Long enough description.', category: 'Bug', severity: 'Major', priority: 'Low' },
      }],
    });
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValueOnce(draft('First title')).mockResolvedValueOnce(draft('Second title'));

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('File it');
    await screen.findByText('Draft: First title');
    say('Change the title');
    await screen.findByText('Draft: Second title');

    expect(screen.getByText('Replaced by the newer draft below')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Confirm' })).toHaveLength(1);
    const secondHistory = sendAssistantMessage.mock.calls[1][0];
    expect(secondHistory[1].notes.some((note) => note.includes('Status: waiting for the user to confirm'))).toBe(true);
  });

  describe('refinements', () => {
    const openPanel = async () => {
      render(<AssistantWidget />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    };
    beforeEach(() => getAssistantStatus.mockResolvedValue({ enabled: true }));
    afterEach(() => window.localStorage.removeItem('assistant.hinted'));

    it('Stop cancels the answer and puts the question back in the box', async () => {
      sendAssistantMessage.mockImplementationOnce((_history, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }));
      await openPanel();
      say('What is overdue?');
      fireEvent.click(await screen.findByRole('button', { name: 'Stop answering' }));
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message the assistant' }).value).toBe('What is overdue?'));
    });

    it('a failed answer offers Try again, which sends the same question', async () => {
      sendAssistantMessage
        .mockRejectedValueOnce(Object.assign(new Error('The assistant is unavailable right now.'), { status: 502 }))
        .mockResolvedValueOnce({ reply: 'Nothing is overdue.', actions: [] });
      await openPanel();
      say('What is overdue?');
      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Nothing is overdue.', { selector: '.assistant-bubble p' })).toBeTruthy();
      expect(sendAssistantMessage.mock.calls[1][0].filter((message) => message.content === 'What is overdue?')).toHaveLength(1);
    });

    it('warns at 80% of the daily allowance', async () => {
      getAssistantStatus.mockResolvedValue({
        enabled: true, usage: { percent: 85, limitInr: 100, usedInr: 85, resetsAt: '2026-10-01T18:30:00.000Z' },
      });
      await openPanel();
      expect(screen.getByText(/used 85% of today/)).toBeTruthy();
    });

    it('Ctrl+J opens and closes the chat', async () => {
      render(<AssistantWidget />);
      await screen.findByRole('button', { name: 'Open assistant' });
      fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
      expect(await screen.findByRole('dialog', { name: 'Assistant' })).toBeTruthy();
      fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
      expect(await screen.findByRole('button', { name: 'Open assistant' })).toBeTruthy();
    });

    it('shows a first-visit tip once, until dismissed', async () => {
      const view = render(<AssistantWidget />);
      expect(await screen.findByRole('note')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }));
      expect(screen.queryByRole('note')).toBeNull();
      view.unmount();
      render(<AssistantWidget />);
      await screen.findByRole('button', { name: 'Open assistant' });
      expect(screen.queryByRole('note')).toBeNull();
    });
  });

  describe('sizes', () => {
    /** Pretends the window matches the given media queries. */
    const screenMatches = (...queries) => vi.stubGlobal('matchMedia', (query) => ({
      matches: queries.includes(query), addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const panel = () => screen.getByRole('dialog', { name: 'Assistant' });
    const openPanel = async () => {
      getAssistantStatus.mockResolvedValue({ enabled: true });
      render(<AssistantWidget />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    };

    afterEach(() => {
      vi.unstubAllGlobals();
      window.localStorage.removeItem('assistant.size');
    });

    it('goes full screen and back; Esc steps down before it closes; the size is remembered', async () => {
      await openPanel();
      expect(panel().className).toContain('is-float');

      fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
      expect(panel().className).toContain('is-full');
      expect(window.localStorage.getItem('assistant.size')).toBe('full');

      fireEvent.keyDown(panel(), { key: 'Escape' });
      expect(panel().className).toContain('is-float');
      fireEvent.keyDown(panel(), { key: 'Escape' });
      expect(await screen.findByRole('button', { name: 'Open assistant' })).toBeTruthy();
    });

    it('docks beside the page on a wide screen, and floats on a narrower one', async () => {
      screenMatches('(min-width: 1100px)');
      await openPanel();
      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Dock beside the page' }));
      expect(panel().className).toContain('is-dock');
      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      expect(screen.getByRole('menuitem', { name: 'Float in the corner' })).toBeTruthy();
    });

    it('is a sheet on phones, with no size controls', async () => {
      screenMatches('(max-width: 820px)');
      window.localStorage.setItem('assistant.size', 'full');
      await openPanel();
      expect(panel().className).toContain('is-sheet');
      expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      expect(screen.queryByRole('menuitem', { name: /Dock beside/ })).toBeNull();
    });
  });

  describe('more options menu', () => {
    it('New chat sets the chat aside, and Recent chats brings it back', async () => {
      getAssistantStatus.mockResolvedValue({ enabled: true });
      sendAssistantMessage.mockResolvedValue({ reply: 'Two tickets are overdue.', actions: [] });
      render(<AssistantWidget />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
      say('What is overdue?');
      await screen.findByText('Two tickets are overdue.', { selector: '.assistant-bubble p' });

      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'New chat' }));
      expect(screen.queryByText('Two tickets are overdue.', { selector: '.assistant-bubble p' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      fireEvent.click(screen.getByRole('menuitem', { name: /What is overdue\?/ }));
      expect(screen.getByText('Two tickets are overdue.', { selector: '.assistant-bubble p' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      expect(screen.queryByRole('menuitem', { name: /What is overdue\?/ })).toBeNull(); // it is the open chat again
      // A fresh chat lists it in the empty state too, not only in the menu.
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'New chat' }), { key: 'Escape' });
      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'New chat' }));
      const recent = screen.getByRole('navigation', { name: 'Recent chats' });
      fireEvent.click(within(recent).getByRole('button', { name: /What is overdue\?/ }));
      expect(screen.getByText('Two tickets are overdue.', { selector: '.assistant-bubble p' })).toBeTruthy();
    });

    const openMenu = async () => {
      getAssistantStatus.mockResolvedValue({ enabled: true });
      render(<AssistantWidget />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      return screen.getByRole('menu', { name: 'More options' });
    };

    it('holds new chat and read aloud; read aloud shows whether it is on', async () => {
      const menu = await openMenu();
      expect(screen.getByRole('menuitem', { name: 'New chat' }).disabled).toBe(true); // nothing to clear yet
      const aloud = screen.getByRole('menuitemcheckbox', { name: /Read replies aloud/ });
      expect(aloud.getAttribute('aria-checked')).toBe('false');
      fireEvent.click(aloud);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(window.localStorage.getItem('assistant.speak')).toBe('1');
      expect(menu).toBeTruthy();
    });

    it('Esc closes the menu but not the chat, and arrows move between items', async () => {
      await openMenu();
      const aloud = screen.getByRole('menuitemcheckbox', { name: /Read replies aloud/ });
      expect(document.activeElement).toBe(aloud); // New chat is disabled, so the first usable item
      fireEvent.keyDown(aloud, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(aloud); // the only usable item wraps to itself
      fireEvent.keyDown(aloud, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Assistant' })).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More options' }));
    });
  });

  it('shows the reply as it streams in, then the finished reply in its place', async () => {
    let finish;
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockImplementationOnce((_history, { onText }) => {
      onText('Checking the board');
      return new Promise((resolve) => { finish = resolve; });
    });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Anything overdue?');
    expect(await screen.findByText('Checking the board')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Assistant is thinking' })).toBeNull();

    await act(async () => finish({ reply: 'Nothing is overdue.', actions: [] }));
    expect(await screen.findByText('Nothing is overdue.')).toBeTruthy();
    expect(screen.queryByText('Checking the board')).toBeNull();
  });

  it('sends a reply back with the server\'s signature, and its notes apart', async () => {
    const sig = 'a'.repeat(64);
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage
      .mockResolvedValueOnce({ reply: 'WEB-1 is In Progress.', actions: [], sig })
      .mockResolvedValueOnce({ reply: 'Ok.', actions: [] });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Status of WEB-1?');
    await screen.findByText('In Progress.', { exact: false, selector: '.assistant-bubble p' });
    say('Thanks');
    await screen.findByText('Ok.');

    const [, reply] = sendAssistantMessage.mock.calls[1][0];
    expect(reply).toEqual({ role: 'assistant', content: 'WEB-1 is In Progress.', sig });
  });

  it('keeps the conversation across a reload of the tab, and New chat clears it', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({ reply: 'Remember me.', actions: [] });
    const first = render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('hello');
    await screen.findByText('Remember me.');
    first.unmount();

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    expect(await screen.findByText('Remember me.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New chat' }));
    expect(screen.queryByText('Remember me.')).toBeNull();
    expect(window.sessionStorage.getItem('assistant.chat:u1')).toBeNull();
  });

  it('offers voice mode from its own button, and explains when the browser cannot record', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start voice mode' }));
    // No microphone in jsdom: voice mode ends and the chat opens to say why.
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't supported/);
    expect(screen.queryByRole('region', { name: 'Voice mode' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Assistant' })).toBeTruthy();
  });

  it('closing plays the exit animation, then hands focus back to the chat button', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Close assistant' }));
      expect(screen.getByRole('dialog', { name: 'Assistant' }).className).toContain('is-closing');
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByRole('dialog', { name: 'Assistant' })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open assistant' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a reply that lands while the chat is shut marks the button until the chat opens', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    let answer;
    sendAssistantMessage.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('How many are overdue?');
    fireEvent.click(screen.getByRole('button', { name: 'Close assistant' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Assistant' })).toBeNull());

    await act(async () => { answer({ reply: 'Three are overdue.', actions: [] }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant, 1 new reply' }));
    expect(screen.getByText('Three are overdue.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close assistant' }));
    expect(await screen.findByRole('button', { name: 'Open assistant' })).toBeTruthy();
  });

  it('a reload keeps the chat, even with React running effects twice (dev mode)', async () => {
    window.sessionStorage.setItem('assistant.chat:u1', JSON.stringify([
      { role: 'user', content: 'before reload' }, { role: 'assistant', content: 'still here' },
    ]));
    getAssistantStatus.mockResolvedValue({ enabled: true });
    render(<StrictMode><AssistantWidget /></StrictMode>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    expect(await screen.findByText('still here')).toBeTruthy();
    expect(window.sessionStorage.getItem('assistant.chat:u1')).toContain('still here');
  });

  it('"confirm" answers the newest card even when an older card is still waiting', async () => {
    window.sessionStorage.setItem('assistant.chat:u1', JSON.stringify([
      { role: 'assistant', content: 'old', actions: [{ id: 'old1', type: 'comment', ticketId: 'WEB-1', content: 'stale', internal: false, status: 'pending' }] },
    ]));
    getAssistantStatus.mockResolvedValue({ enabled: true });
    getTicket.mockResolvedValue({ revision: 2 });
    transitionTicket.mockResolvedValue({});
    sendAssistantMessage.mockResolvedValue({
      reply: 'Move it?',
      actions: [{ id: 'm2', type: 'stage_change', ticketId: 'TES4-3', from: 'pending', to: 'under_review' }],
    });
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('move TES4-3 to review');
    await screen.findByText('Move it?');

    say('confirm');
    await waitFor(() => expect(transitionTicket).toHaveBeenCalledWith('TES4-3', { to: 'under_review', revision: 2 }));
    expect(sendAssistantMessage).toHaveBeenCalledTimes(1); // "confirm" never reached the model
    expect(addComment).not.toHaveBeenCalled();
  });

  it('only messages that arrive while the chat is open animate in', async () => {
    window.sessionStorage.setItem('assistant.chat:u1', JSON.stringify([
      { role: 'user', content: 'old question' }, { role: 'assistant', content: 'old answer' },
    ]));
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({ reply: 'fresh answer', actions: [] });
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));

    expect(screen.getByText('old answer').closest('.assistant-msg').className).not.toContain('is-new');
    say('new question');
    await screen.findByText('fresh answer');
    expect(screen.getByText('new question').closest('.assistant-msg').className).toContain('is-new');
    expect(screen.getByText('fresh answer').closest('.assistant-msg').className).toContain('is-new');
  });

  it('never shows one person’s chat to the next person signed in to the same tab', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockResolvedValue({ reply: 'WEB-9 details for Ada only.', actions: [] });
    const view = render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('show WEB-9');
    await screen.findByText(/details for Ada only/, { selector: '.assistant-bubble p' });

    // Someone else signs in (or an admin starts impersonating) without a reload.
    auth.user = { id: 'u2', name: 'Bo' };
    view.rerender(<AssistantWidget />);

    await waitFor(() => expect(screen.queryByText(/details for Ada only/)).toBeNull());
    expect(window.sessionStorage.getItem('assistant.chat:u1')).toBeNull();
  });

  it('always tells people the assistant is AI and that OpenAI processes their data', async () => {
    getAssistantStatus.mockResolvedValue({ enabled: true });
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    expect(screen.getByText(/can make mistakes.*processed by OpenAI/)).toBeTruthy();
  });

  it('shows today’s usage ring and refreshes it after a message', async () => {
    const usage = (percent) => ({ percent, limitInr: 100, usedInr: percent, resetsAt: '2026-09-23T18:30:00.000Z' });
    getAssistantStatus.mockResolvedValueOnce({ enabled: true, usage: usage(10) })
      .mockResolvedValue({ enabled: true, usage: usage(12) });
    sendAssistantMessage.mockResolvedValue({ reply: 'ok', actions: [] });
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    expect(screen.getByRole('meter', { name: 'Assistant usage today' }).getAttribute('aria-valuenow')).toBe('10');
    say('hi');
    await screen.findByText('ok');
    await waitFor(() => expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('12'));
  });

  it('tells the assistant which page, ticket and tab the user is on', async () => {
    window.history.replaceState(null, '', '/tickets?view=modules&ticket=TES4-5&tab=attachments');
    try {
      expect(currentPage()).toEqual({
        path: '/tickets', ticketId: 'TES4-5', tab: 'attachments', query: '?view=modules&ticket=TES4-5&tab=attachments',
      });
      window.history.replaceState(null, '', '/tickets?ticket=TES4-5');
      expect(currentPage().tab).toBe('discussion');
      window.history.replaceState(null, '', '/tickets/board');
      expect(currentPage()).toEqual({ path: '/tickets/board', ticketId: null, tab: null, query: '' });

      getAssistantStatus.mockResolvedValue({ enabled: true });
      sendAssistantMessage.mockResolvedValue({ reply: 'ok', actions: [] });
      render(<AssistantWidget />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
      say('open the details tab');
      await screen.findByText('ok');
      expect(sendAssistantMessage.mock.calls[0][1].page).toEqual({
        path: '/tickets/board', ticketId: null, tab: null, query: '', project: 'WEB',
      });
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
  describe('ticket actions', () => {
    const open = async (actions) => {
      getAssistantStatus.mockResolvedValue({ enabled: true });
      sendAssistantMessage.mockResolvedValue({ reply: 'Here you go.', actions });
      render(<AssistantWidget />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
      say('do it');
      await screen.findByText('Here you go.');
    };

    it('posts a drafted comment once confirmed, with the draft id as its retry key', async () => {
      await open([{ id: 'c1', type: 'comment', ticketId: 'WEB-5', content: 'Fixed on staging.', internal: false }]);
      expect(screen.getByText('Comment on WEB-5')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await screen.findByText('Done');
      expect(addComment).toHaveBeenCalledWith('WEB-5', { content: 'Fixed on staging.', internal: false, clientRef: 'c1' });
      // The server doesn't notify the author, so the open drawer is told directly.
      expect(publish).toHaveBeenCalledWith({ type: 'ticket.comment', ticketId: 'WEB-5', self: true });
    });

    it('posts a reply with its @mentions', async () => {
      await open([{
        id: 'c2', type: 'comment', ticketId: 'WEB-5', content: '@Riya Sharma Checking now.', internal: false, mentions: ['u9'],
      }]);
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await screen.findByText('Done');
      expect(addComment).toHaveBeenCalledWith('WEB-5', {
        content: '@Riya Sharma Checking now.', internal: false, clientRef: 'c2', mentions: ['u9'],
      });
    });

    it('assigns several tickets one by one, each with its fresh revision', async () => {
      getTicket.mockImplementation(async (id) => ({ revision: id === 'WEB-1' ? 3 : 7 }));
      await open([{
        id: 'a1', type: 'assign', ticketIds: ['WEB-1', 'WEB-2'], from: [null, 'Ravi'], assigneeId: 'u9', assigneeName: 'Riya',
      }]);
      expect(screen.getByText('Assign 2 tickets')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await screen.findByText('Done');
      expect(assignTicket.mock.calls).toEqual([
        ['WEB-1', { assignedTo: 'u9', revision: 3 }],
        ['WEB-2', { assignedTo: 'u9', revision: 7 }],
      ]);
    });

    it('files added in the chat reach the model as a note, prefill the attach card, and upload on confirm', async () => {
      getAssistantStatus.mockResolvedValue({ enabled: true });
      sendAssistantMessage.mockResolvedValue({
        reply: 'Attach to WEB-5 "Inbox empty" in WEB?',
        actions: [{ id: 'f1', type: 'attach_files', ticketId: 'WEB-5', projectKey: 'WEB', title: 'Inbox empty', note: 'Screenshots' }],
      });
      render(<AssistantWidget />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));

      const shot = new File(['x'], 'shot.png', { type: 'image/png' });
      const virus = new File(['x'], 'run.exe', { type: 'application/octet-stream' });
      fireEvent.change(screen.getByTestId('assistant-file-input'), { target: { files: [shot, virus] } });
      expect(screen.getByRole('list', { name: 'Files ready to attach' }).textContent).toContain('shot.png');
      expect(screen.getByRole('alert').textContent).toMatch(/run\.exe: Type not allowed/);

      say('attach this to WEB-5');
      await screen.findByText('Attach files to WEB-5');
      expect(sendAssistantMessage.mock.calls[0][0].at(-1).content)
        .toBe('attach this to WEB-5\n[Files ready to attach: shot.png]');

      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await screen.findByText('Done');
      const [ticketId, form] = uploadAttachments.mock.calls[0];
      expect(ticketId).toBe('WEB-5');
      expect(form.getAll('files').map((entry) => entry.name)).toEqual(['shot.png']);
      expect(form.get('clientRef')).toBe('f1');
      expect(form.get('commentContent')).toBe('Screenshots');
      // Uploaded files leave the tray.
      expect(screen.queryByRole('list', { name: 'Files ready to attach' })).toBeNull();
    });

    it('moves several tickets on one card; if one fails, the rest stay on the card to retry', async () => {
      getTicket.mockResolvedValue({ revision: 1 });
      transitionTicket
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }))
        .mockResolvedValue({});
      await open([{
        id: 's1', type: 'stage_change', ticketIds: ['WEB-1', 'WEB-2', 'WEB-3'], froms: ['pending', 'pending', 'pending'], to: 'under_review',
      }]);
      expect(screen.getByText('Move 3 tickets')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/^Done: WEB-1\. WEB-2:/);
      expect(screen.getByText('Move 2 tickets')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByText('Done');
      expect(transitionTicket.mock.calls.map(([id]) => id)).toEqual(['WEB-1', 'WEB-2', 'WEB-2', 'WEB-3']);
    });

    it('a move card that sets estimate dates saves them first, then moves with the new revision', async () => {
      getTicket.mockResolvedValue({ revision: 4 });
      patchTicket.mockResolvedValue({ revision: 5 });
      transitionTicket.mockResolvedValue({});
      await open([{
        id: 'm1', type: 'stage_change', ticketId: 'TES4-3', from: 'under_review', to: 'ready_production',
        dates: { due: '2026-09-29', release: '2026-10-06' },
      }]);
      expect(screen.getByText('2026-10-06')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await screen.findByText('Done');
      expect(patchTicket).toHaveBeenCalledWith('TES4-3', {
        estimatedResolutionAt: '2026-09-29', expectedReleaseDate: '2026-10-06', revision: 4,
      });
      expect(transitionTicket).toHaveBeenCalledWith('TES4-3', { to: 'ready_production', revision: 5 });
    });

    it('the attach card has the Attachments-tab drop area, before any file is added', async () => {
      await open([{ id: 'f3', type: 'attach_files', ticketId: 'WEB-5', projectKey: 'WEB', title: 'Inbox empty' }]);
      expect(screen.getByRole('button', { name: /Drag files here or browse/ })).toBeTruthy();
      const file = new File(['x'], 'log.txt', { type: 'text/plain' });
      fireEvent.change(screen.getByTestId('assistant-drop-input'), { target: { files: [file] } });
      expect(screen.getByRole('button', { name: 'Confirm' }).disabled).toBe(false);
      expect(screen.getByRole('button', { name: /Add more/ })).toBeTruthy();
    });

    it('an attach card with no files cannot be confirmed', async () => {
      await open([{ id: 'f2', type: 'attach_files', ticketId: 'WEB-5', projectKey: 'WEB', title: 'Inbox empty' }]);
      expect(screen.getByRole('button', { name: 'Confirm' }).disabled).toBe(true);
    });

    it('watches right away, with no card', async () => {
      watchTicket.mockResolvedValue({});
      await open([{ id: 'w1', type: 'watch', ticketId: 'WEB-5', watch: true }]);
      expect(watchTicket).toHaveBeenCalledWith('WEB-5');
      expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    });
  });
});

describe('ticket context chip', () => {
  beforeEach(() => {
    getAssistantStatus.mockReset().mockResolvedValue({ enabled: true });
    sendAssistantMessage.mockReset().mockResolvedValue({ reply: 'Okay.', actions: [] });
    window.localStorage.clear();
    window.sessionStorage.clear();
    auth.user = { id: 'u1', name: 'Ada' };
  });
  afterEach(() => window.history.replaceState(null, '', '/'));

  const pageSent = () => sendAssistantMessage.mock.calls.at(-1)[1].page;

  it('adds a reply to the open ticket as an internal note draft, posted only on confirm', async () => {
    addComment.mockReset();
    window.history.replaceState(null, '', '/tickets?ticket=WEB-12');
    sendAssistantMessage.mockResolvedValue({ reply: 'Login fails on Safari only.', actions: [], sig: 'b'.repeat(64) });
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('Summarise this ticket');
    fireEvent.click(await screen.findByRole('button', { name: 'Add to WEB-12' }));

    expect(screen.getByText('Internal note on WEB-12')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to WEB-12' })).toBeNull(); // once per reply
    expect(addComment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(addComment).toHaveBeenCalledWith('WEB-12', expect.objectContaining({
      content: 'Login fails on Safari only.', internal: true,
    })));
  });

  it('offers no "Add to" without an open ticket', async () => {
    sendAssistantMessage.mockResolvedValue({ reply: 'Nothing is overdue.', actions: [], sig: 'b'.repeat(64) });
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    say('What is overdue?');
    await screen.findByText('Nothing is overdue.', { selector: '.assistant-bubble p' });
    expect(screen.queryByRole('button', { name: /^Add to/ })).toBeNull();
  });

  it('shows the open ticket, and dismissing it stops sending that ticket', async () => {
    window.history.replaceState(null, '', '/tickets?view=list&ticket=WEB-12&tab=details');
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));

    expect(await screen.findByText('WEB-12')).toHaveClass('assistant-context-id');
    say('Who owns this?');
    await screen.findByText('Okay.');
    expect(pageSent()).toMatchObject({ ticketId: 'WEB-12', tab: 'details' });

    fireEvent.click(screen.getByRole('button', { name: "Don't use WEB-12 as context" }));
    expect(screen.queryByText('WEB-12')).toBeNull();
    say('List my tickets');
    await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledTimes(2));
    expect(pageSent()).toMatchObject({ ticketId: null, tab: null, query: '?view=list' });
  });

  it('follows the address as tickets open and close, and comes back for another ticket', async () => {
    const view = render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open assistant' }));
    expect(screen.queryByRole('button', { name: /as context/ })).toBeNull();

    // The client router changes the query; the widget re-renders with it.
    window.history.replaceState(null, '', '/tickets?ticket=WEB-12');
    view.rerender(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: "Don't use WEB-12 as context" }));
    expect(screen.queryByRole('button', { name: /as context/ })).toBeNull();

    window.history.replaceState(null, '', '/tickets?ticket=WEB-13');
    view.rerender(<AssistantWidget />);
    expect(await screen.findByRole('button', { name: "Don't use WEB-13 as context" })).toBeInTheDocument();
    say('What is this about?');
    await screen.findByText('Okay.');
    expect(pageSent().ticketId).toBe('WEB-13');

    window.history.replaceState(null, '', '/tickets');
    view.rerender(<AssistantWidget />);
    await waitFor(() => expect(screen.queryByRole('button', { name: /as context/ })).toBeNull());
  });
});

test('a ticket draft marks guessed fields until the user picks them', () => {
  const action = {
    id: 'g1', type: 'create_ticket', projectKey: 'WEB', status: 'pending', guessed: ['severity'],
    body: { title: 'Login broken', description: 'Login does nothing on tap.', category: 'Bug', severity: 'Major', priority: 'High', environment: 'Staging' },
  };
  const onChange = vi.fn();
  render(<TicketDraftFields action={action} onChange={onChange} />);
  expect(screen.getByText('Severity (guessed)')).toBeInTheDocument();
  expect(screen.getByText('Priority')).toBeInTheDocument();
});
