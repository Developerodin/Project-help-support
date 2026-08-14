'use client';

import Link from 'next/link';
import useSWR from 'swr';
import Icon from '@/shared/components/icons.jsx';
import { listNotifications, markAllRead, markRead } from '@/shared/api/notifications.js';
import { formatRelativeTime, notificationHref } from '@/shared/lib/notification-utils.js';
import AppLoader from '@/shared/components/app-loader.jsx';

const POLL_MS = 30_000;
const PAGE_LIMIT = 30;

export default function NotificationsPage() {
  const { data, mutate, isLoading } = useSWR(
    'notifications-inbox',
    () => listNotifications({ limit: PAGE_LIMIT }),
    { refreshInterval: POLL_MS },
  );

  const items = data?.results ?? [];
  const unreadCount = items.filter((n) => !n.readAt).length;

  async function handleMarkRead(id) {
    await markRead(id);
    await mutate();
  }

  async function handleMarkAllRead() {
    await markAllRead();
    await mutate();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p className="sub">Ticket updates and mentions appear here.</p>
        </div>
        <span className="spacer" />
        {unreadCount > 0 && (
          <button type="button" className="btn" onClick={handleMarkAllRead}>
            Mark all read
          </button>
        )}
        <Link href="/settings/notifications" className="btn">
          <Icon name="bell" size={12} /> Preferences
        </Link>
      </div>

      {isLoading && items.length === 0 && <AppLoader inline />}

      {!isLoading && items.length === 0 && (
        <div className="empty-state">
          <h3>No notifications</h3>
          <p>When someone assigns you a ticket or mentions you in a comment, it will show up here.</p>
          <Link href="/tickets" className="btn btn-primary">Browse tickets</Link>
        </div>
      )}

      {items.length > 0 && (
        <div className="notif-list" role="list">
          {items.map((item) => (
            <article
              key={item.id}
              className={`notif-row${item.readAt ? '' : ' unread'}`}
              role="listitem"
            >
              <div className="notif-row__main">
                <Link
                  href={notificationHref(item.link)}
                  className="notif-row__title"
                  onClick={() => { if (!item.readAt) handleMarkRead(item.id); }}
                >
                  {item.title}
                </Link>
                {item.body && <p className="notif-row__body">{item.body}</p>}
                <p className="notif-row__meta meta">
                  <span className="mono">{item.event}</span>
                  <span aria-hidden="true"> · </span>
                  <time dateTime={item.createdAt}>{formatRelativeTime(item.createdAt)}</time>
                </p>
              </div>
              {!item.readAt && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => handleMarkRead(item.id)}
                >
                  Mark read
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
