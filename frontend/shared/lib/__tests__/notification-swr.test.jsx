import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import useSWR from 'swr';
import * as notificationsApi from '@/shared/api/notifications.js';
import {
  fetchNotificationList,
  isNotificationSwrKey,
  markAllNotificationsRead,
  markNotificationRead,
  notificationListSwrKey,
  notificationSwrKeys,
  unreadCountSwrKey,
} from '../notification-swr.js';

vi.mock('@/shared/api/notifications.js', () => ({
  listNotifications: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

describe('notification SWR keys', () => {
  it('matches the [scope, params] array keys useSWR is given, and plain strings', () => {
    expect(isNotificationSwrKey(unreadCountSwrKey())).toBe(true);
    expect(isNotificationSwrKey(notificationListSwrKey(notificationSwrKeys.inbox(2, 30, true), { page: 2 })))
      .toBe(true);
    expect(isNotificationSwrKey(notificationListSwrKey(notificationSwrKeys.recent(true), { forYou: true })))
      .toBe(true);
    expect(notificationSwrKeys.inbox(1, 30, false, true)).not.toBe(notificationSwrKeys.inbox(1, 30, false, false));
    expect(notificationSwrKeys.recent(true)).not.toBe(notificationSwrKeys.recent(false));
    expect(isNotificationSwrKey(['tickets', {}])).toBe(false);
    expect(isNotificationSwrKey(null)).toBe(false);
  });

  it('patches the badge and both tab caches when a notification is marked read', async () => {
    notificationsApi.listNotifications.mockImplementation((params = {}) => Promise.resolve(
      params.unread
        ? { totalResults: 2, results: [{ id: 'a', readAt: null }] }
        : { totalResults: 2, results: [{ id: 'a', readAt: null }, { id: 'b', readAt: null }] },
    ));
    // Held open, so what renders is the optimistic patch alone.
    notificationsApi.markRead.mockReturnValue(new Promise(() => {}));
    notificationsApi.markAllRead.mockReturnValue(new Promise(() => {}));

    function Probe() {
      const { data: count } = useSWR(unreadCountSwrKey(), fetchNotificationList);
      const { data: list } = useSWR(
        notificationListSwrKey(notificationSwrKeys.recent(false), { limit: 8, forYou: false }),
        fetchNotificationList,
      );
      const { data: forYouList } = useSWR(
        notificationListSwrKey(notificationSwrKeys.inbox(1, 30, false, true), { page: 1, limit: 30, forYou: true }),
        fetchNotificationList,
      );
      const readIn = (data) => (data?.results ?? []).filter((item) => item.readAt).map((item) => item.id).join(',') || 'none';
      return <p>{`count:${count?.totalResults ?? '-'} read:${readIn(list)} forYou:${readIn(forYouList)}`}</p>;
    }

    render(<Probe />);
    expect(await screen.findByText('count:2 read:none forYou:none')).toBeInTheDocument();

    act(() => { markNotificationRead('a'); });
    expect(await screen.findByText('count:1 read:a forYou:a')).toBeInTheDocument();

    act(() => { markAllNotificationsRead(); });
    expect(await screen.findByText('count:0 read:a,b forYou:a,b')).toBeInTheDocument();
  });
});
