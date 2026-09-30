import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import userEvent from '@testing-library/user-event';
import NotificationBell from '../notification-bell.jsx';
import * as notificationsApi from '@/shared/api/notifications.js';

const mockProjectId = '507f1f77bcf86cd799439011';

vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: () => ({
    activeProjectId: mockProjectId,
    loading: false,
  }),
}));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({ impersonation: null }),
}));

vi.mock('@/shared/api/notifications.js', () => ({
  listNotifications: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  getPushConfig: vi.fn(),
}));

// A fresh cache per test, so one test's lists never answer another's keys.
function renderBell() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NotificationBell />
    </SWRConfig>,
  );
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationsApi.listNotifications.mockImplementation((params = {}) => {
      if (params.unread) {
        return Promise.resolve({ totalResults: 2, results: [{ id: '1', readAt: null }] });
      }
      return Promise.resolve({
        totalResults: 2,
        results: [
          {
            id: '1',
            title: 'WEB-1 · Assigned',
            body: 'Assigned to Jane',
            event: 'TICKET_ASSIGNED',
            link: 'http://localhost:3000/tickets?ticket=WEB-1',
            ticket: { id: 'ticket-oid-1', ticketId: 'WEB-1' },
            project: { id: 'p1', key: 'WEB', name: 'Web' },
            readAt: null,
            createdAt: new Date().toISOString(),
          },
          {
            id: '2',
            title: 'Asha commented on WEB-1',
            event: 'TICKET_COMMENTED',
            link: 'http://localhost:3000/tickets?ticket=WEB-1',
            ticket: { id: 'ticket-oid-1', ticketId: 'WEB-1' },
            readAt: null,
            createdAt: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      });
    });
  });

  it('shows unread badge count', async () => {
    renderBell();
    expect(await screen.findByLabelText('2 unread notifications')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('opens dropdown with recent notifications', async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(await screen.findByLabelText('2 unread notifications'));

    expect(await screen.findByText('WEB-1 · Assigned')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View all notifications/i })).toHaveAttribute('href', '/notifications');
  });

  it("reads the ticket's other unread rows too when a row is opened", async () => {
    const user = userEvent.setup();
    notificationsApi.markAllRead.mockResolvedValue({});
    renderBell();

    await user.click(await screen.findByLabelText('2 unread notifications'));
    // Rows are no longer folded client-side: both rows for WEB-1 show.
    expect(await screen.findByText('Asha commented on WEB-1')).toBeInTheDocument();
    expect(screen.queryByText(/more for WEB-1/)).not.toBeInTheDocument();
    await user.click(screen.getByText('WEB-1 · Assigned'));

    await waitFor(() => {
      expect(notificationsApi.markAllRead).toHaveBeenCalledWith({ ticket: 'ticket-oid-1' });
    });
    expect(notificationsApi.markRead).not.toHaveBeenCalled();
  });

  it('opens with focus on the first notification, not "Mark all read"', async () => {
    const user = userEvent.setup();
    renderBell();

    screen.getByRole('button', { name: /notifications/i }).focus();
    await user.keyboard('{Enter}');

    const firstRow = await screen.findByRole('link', { name: /WEB-1 · Assigned/ });
    await waitFor(() => expect(firstRow).toHaveFocus());
  });

  it('shows the project key and says a row is unread in words', async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(await screen.findByLabelText('2 unread notifications'));
    expect(await screen.findByText('WEB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Unread: WEB-1 · Assigned' })).toBeInTheDocument();
  });

  it('opens on "For you", asks for forYou, and switches tabs by click and arrow keys', async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(await screen.findByLabelText('2 unread notifications'));
    const forYouTab = screen.getByRole('tab', { name: 'For you' });
    const allTab = screen.getByRole('tab', { name: 'All' });
    expect(forYouTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', forYouTab.id);
    await waitFor(() => expect(notificationsApi.listNotifications)
      .toHaveBeenCalledWith({ limit: 8, forYou: true }));
    expect(notificationsApi.listNotifications).not.toHaveBeenCalledWith({ limit: 8, forYou: false });

    await user.click(allTab);
    expect(allTab).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(notificationsApi.listNotifications)
      .toHaveBeenCalledWith({ limit: 8, forYou: false }));

    allTab.focus();
    await user.keyboard('{ArrowLeft}');
    expect(forYouTab).toHaveAttribute('aria-selected', 'true');
    expect(forYouTab).toHaveFocus();
  });

  it('offers All when nothing is for you', async () => {
    const user = userEvent.setup();
    notificationsApi.listNotifications.mockImplementation((params = {}) => Promise.resolve(
      params.forYou
        ? { totalResults: 0, results: [] }
        : { totalResults: 1, results: [{ id: '9', title: 'Asha moved WEB-3 to Done', readAt: null, createdAt: new Date().toISOString() }] },
    ));
    renderBell();

    await user.click(await screen.findByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('Nothing for you right now.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(await screen.findByText('Asha moved WEB-3 to Done')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows merged updates, times rows by activityAt, and tags "for you" rows in All', async () => {
    const user = userEvent.setup();
    const created = '2026-01-01T10:00:00.000Z';
    const activity = new Date(Date.now() - 5 * 60_000).toISOString();
    notificationsApi.listNotifications.mockImplementation((params = {}) => Promise.resolve(
      params.unread
        ? { totalResults: 1, results: [] }
        : {
          totalResults: 2,
          results: [
            { id: '1', title: 'Asha moved WEB-12 to Done', event: 'TICKET_STAGE_CHANGED', count: 3, readAt: null, createdAt: created, activityAt: activity },
            { id: '2', title: 'Asha mentioned you on WEB-4', event: 'TICKET_MENTIONED', forYou: true, readAt: null, createdAt: activity },
          ],
        },
    ));
    renderBell();

    await user.click(await screen.findByRole('button', { name: /notifications/i }));
    await user.click(screen.getByRole('tab', { name: 'All' }));
    const row = (await screen.findByText('Asha moved WEB-12 to Done')).closest('.notif-row');
    expect(within(row).getByText('3 updates')).toBeInTheDocument();
    expect(within(row).getByText('5m ago')).toHaveAttribute('datetime', activity);
    expect(within(row).queryByText('For you')).not.toBeInTheDocument();

    const mention = screen.getByText('Asha mentioned you on WEB-4').closest('.notif-row');
    expect(within(mention).getByText('For you')).toBeInTheDocument();
    expect(within(mention).queryByText(/updates/)).not.toBeInTheDocument();
  });
});
