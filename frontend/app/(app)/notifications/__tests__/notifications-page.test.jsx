import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import * as notificationsApi from '@/shared/api/notifications.js';
import NotificationsPage from '../page.jsx';

const replace = vi.fn();
let search = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock('@/shared/api/notifications.js', () => ({
  listNotifications: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NotificationsPage />
    </SWRConfig>,
  );
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search = '';
    notificationsApi.listNotifications.mockImplementation((params = {}) => Promise.resolve(
      params.forYou
        ? { totalResults: 0, totalPages: 1, results: [] }
        : {
          totalResults: 2,
          totalPages: 1,
          results: [
            {
              id: '1',
              title: 'Asha moved WEB-12 to Done',
              event: 'TICKET_STAGE_CHANGED',
              link: '/tickets?ticket=WEB-12',
              ticket: { id: 't12', ticketId: 'WEB-12' },
              count: 3,
              readAt: null,
              createdAt: '2026-01-01T10:00:00.000Z',
              activityAt: new Date().toISOString(),
            },
            {
              id: '2',
              title: 'Asha mentioned you on WEB-12',
              event: 'TICKET_MENTIONED',
              link: '/tickets?ticket=WEB-12',
              ticket: { id: 't12', ticketId: 'WEB-12' },
              forYou: true,
              readAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
        },
    ));
  });

  it('defaults to "For you", asks for forYou, and offers All when empty', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('tab', { name: 'For you' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Nothing for you right now')).toBeInTheDocument();
    expect(notificationsApi.listNotifications)
      .toHaveBeenCalledWith({ page: 1, limit: 30, unread: false, forYou: true });

    await user.click(screen.getByRole('button', { name: 'Show all notifications' }));
    expect(replace).toHaveBeenCalledWith('/notifications?tab=all', { scroll: false });
  });

  it('keeps the unread filter when switching tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    search = 'unread=1';
    renderPage();

    screen.getByRole('tab', { name: 'For you' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(replace).toHaveBeenCalledWith('/notifications?unread=1&tab=all', { scroll: false });
  });

  it('on All, sums merged updates per ticket card and tags "for you" rows', async () => {
    search = 'tab=all';
    renderPage();

    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    const card = (await screen.findByText('Asha moved WEB-12 to Done')).closest('article');
    expect(within(card).getByText('4 updates · 4 unread')).toBeInTheDocument();
    expect(within(card).getByText('3 updates')).toBeInTheDocument();
    expect(within(card).getByText('For you')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    await waitFor(() => expect(notificationsApi.listNotifications)
      .toHaveBeenCalledWith({ page: 1, limit: 30, unread: false, forYou: false }));
  });
});
