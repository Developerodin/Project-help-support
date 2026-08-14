'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import Icon from '@/shared/components/icons.jsx';
import { listNotifications, markAllRead, markRead } from '@/shared/api/notifications.js';
import { formatRelativeTime, notificationHref } from '@/shared/lib/notification-utils.js';

const POLL_MS = 30_000;
const DROPDOWN_LIMIT = 8;

function unreadCountFrom(data) {
  return data?.totalResults ?? 0;
}

export default function NotificationBell() {
  const wrapRef = useRef(null);
  const [open, setOpen] = useState(false);

  const { data: unreadData, mutate: mutateUnread } = useSWR(
    'notifications-unread-count',
    () => listNotifications({ unread: true, limit: 1 }),
    { refreshInterval: POLL_MS },
  );

  const { data: recentData, mutate: mutateRecent } = useSWR(
    open ? 'notifications-recent' : null,
    () => listNotifications({ limit: DROPDOWN_LIMIT }),
    { refreshInterval: open ? POLL_MS : 0 },
  );

  const unreadCount = unreadCountFrom(unreadData);
  const badge = unreadCount > 99 ? '99+' : String(unreadCount);

  const refresh = useCallback(async () => {
    await Promise.all([mutateUnread(), mutateRecent()]);
  }, [mutateUnread, mutateRecent]);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleOpen() {
    setOpen((was) => !was);
  }

  async function handleMarkRead(id) {
    await markRead(id);
    await refresh();
  }

  async function handleMarkAllRead() {
    await markAllRead();
    await refresh();
  }

  const items = recentData?.results ?? [];

  return (
    <div className="menuwrap notif-bell" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ico notif-bell__trigger"
        aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={handleOpen}
      >
        <Icon name="bell" size={14} />
        {unreadCount > 0 && (
          <span className="notif-bell__badge" aria-hidden="true">{badge}</span>
        )}
      </button>

      <div className={`menu wide notif-bell__panel${open ? ' on' : ''}`} role="menu">
        <div className="menucap notif-bell__head">
          <strong>Notifications</strong>
          {unreadCount > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleMarkAllRead}>
              Mark all read
            </button>
          )}
        </div>

        <div className="menuscroll">
          {items.length === 0 && (
            <p className="notif-bell__empty meta">No notifications yet.</p>
          )}
          {items.map((item) => (
            <Link
              key={item.id}
              href={notificationHref(item.link)}
              className={`notif-item${item.readAt ? '' : ' unread'}`}
              role="menuitem"
              onClick={() => {
                if (!item.readAt) handleMarkRead(item.id);
                setOpen(false);
              }}
            >
              <span className="notif-item__title">{item.title}</span>
              {item.body && <span className="notif-item__body">{item.body}</span>}
              <span className="notif-item__when">{formatRelativeTime(item.createdAt)}</span>
            </Link>
          ))}
        </div>

        <div className="menusep" />
        <Link href="/notifications" className="menuitem" role="menuitem" onClick={() => setOpen(false)}>
          View all notifications
        </Link>
      </div>
    </div>
  );
}
