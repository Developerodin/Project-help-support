'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import Icon from '@/shared/components/icons.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import FormError from '@/shared/components/form-error.jsx';
import NotificationTicketCard from '@/shared/components/NotificationTicketCard.jsx';
import { groupNotificationsByTicket, notificationHref } from '@/shared/lib/notification-utils.js';
import {
  NOTIFICATION_INBOX_LIMIT,
  fetchNotificationList,
  listNotificationsParams,
  markAllNotificationsRead,
  markNotificationRead,
  notificationListSwrKey,
  notificationSwrKeys,
  unreadCountFrom,
  useNotificationPollInterval,
  useNotificationProjectScope,
} from '@/shared/lib/notification-swr.js';
import { windowedPageNumbers } from '@/shared/lib/ticket-list-query.js';

export default function NotificationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const unreadOnly = searchParams.get('unread') === '1';
  const [page, setPage] = useState(1);
  // Unread on/off from anywhere (the toggle, the assistant, back/forward) starts at page 1.
  useEffect(() => {
    setPage(1);
  }, [unreadOnly]);
  const limit = NOTIFICATION_INBOX_LIMIT;
  const refreshInterval = useNotificationPollInterval();
  const { projectId, projectLoading } = useNotificationProjectScope();
  const unreadParams = listNotificationsParams({ unread: true, limit: 1 }, projectId);
  const inboxParams = listNotificationsParams({ page, limit, unread: unreadOnly }, projectId);

  const { data: unreadData } = useSWR(
    notificationListSwrKey(notificationSwrKeys.unreadCount(projectId), unreadParams),
    fetchNotificationList,
    { refreshInterval },
  );

  const { data, error, isLoading, mutate } = useSWR(
    notificationListSwrKey(
      notificationSwrKeys.inbox(page, limit, unreadOnly, projectId),
      inboxParams,
    ),
    fetchNotificationList,
    { refreshInterval },
  );

  const showInboxLoader = !error && (
    projectLoading || (Boolean(projectId) && isLoading)
  );

  const items = data?.results ?? [];
  const totalResults = data?.totalResults ?? 0;
  const totalPages = Math.max(1, data?.totalPages ?? 1);
  const unreadCount = unreadCountFrom(unreadData);

  const groups = useMemo(() => groupNotificationsByTicket(items), [items]);

  const pageNumbers = useMemo(
    () => windowedPageNumbers(page, totalPages),
    [page, totalPages],
  );

  const rangeStart = totalResults === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = Math.min(page * limit, totalResults);

  function setUnreadFilter(nextUnreadOnly) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextUnreadOnly) params.set('unread', '1');
    else params.delete('unread');
    const q = params.toString();
    router.replace(q ? `/notifications?${q}` : '/notifications', { scroll: false });
    setPage(1);
  }

  async function handleMarkRead(id) {
    await markNotificationRead(id);
  }

  async function handleMarkAllRead() {
    if (!projectId) return;
    await markAllNotificationsRead(projectId);
    await mutate();
  }

  async function handleTitleClick(event, item) {
    const href = notificationHref(item.link);
    if (!item.readAt) {
      event.preventDefault();
      try {
        await markNotificationRead(item.id);
        router.push(href);
      } catch {
        /* toast in helper */
      }
    }
  }

  const subline = unreadCount > 0
    ? `${unreadCount} unread`
    : 'Stay up to date with activity';

  return (
    <div className="notifications-inbox">
      <header className="notif-inbox__chrome">
        <div className="notif-inbox__intro">
          <h1>Notifications</h1>
          <p className="sub">{subline}</p>
          {totalResults > 0 ? (
            <p className="notif-inbox__meta meta" aria-live="polite">
              {totalResults} notification{totalResults === 1 ? '' : 's'}
              {' · '}
              Showing {rangeStart}–{rangeEnd} of {totalResults}
            </p>
          ) : null}
        </div>
        <div className="notif-inbox__toolbar">
          <div className="seg notif-inbox__seg" role="group" aria-label="Filter notifications">
            <button
              type="button"
              aria-pressed={!unreadOnly}
              onClick={() => setUnreadFilter(false)}
            >
              All
            </button>
            <button
              type="button"
              aria-pressed={unreadOnly}
              onClick={() => setUnreadFilter(true)}
            >
              Unread
            </button>
          </div>
          {unreadCount > 0 && projectId && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleMarkAllRead}
              title="Marks all notifications read for the selected project"
            >
              Mark all read
            </button>
          )}
          <Link
            href="/settings/notifications"
            className="btn btn-sm notif-inbox__prefs"
            aria-label="Notification preferences"
          >
            <Icon name="bell" size={12} aria-hidden="true" />
            <span className="notif-inbox__prefs-label">Preferences</span>
          </Link>
        </div>
      </header>

      {showInboxLoader && <AppLoader inline label="Loading notifications…" ariaLabel="Loading notifications" />}

      {!projectLoading && !projectId && (
        <div className="empty-state">
          <h3>Select a project</h3>
          <p>Use the project switcher in the top bar to see notifications for that project.</p>
        </div>
      )}

      {error && projectId && (
        <div className="notif-inbox__error">
          <FormError error={error} title="Could not load notifications" />
          <button type="button" className="btn btn-sm" onClick={() => mutate()}>
            Retry
          </button>
        </div>
      )}

      {!projectLoading && projectId && !isLoading && !error && items.length === 0 && (
        <div className="empty-state">
          <h3>{unreadOnly ? 'No unread notifications' : 'No notifications'}</h3>
          <p>
            {unreadOnly
              ? 'You are caught up. Show all to see earlier updates.'
              : 'When someone assigns you a ticket or mentions you in a comment, it will show up here.'}
          </p>
          {unreadOnly ? (
            <button type="button" className="btn" onClick={() => setUnreadFilter(false)}>
              Show all
            </button>
          ) : (
            <Link href="/tickets" className="btn btn-primary">Browse tickets</Link>
          )}
        </div>
      )}

      {projectId && items.length > 0 && !error && (
        <>
          <div className="notif-list" role="list">
            {groups.map((group) => (
              <NotificationTicketCard
                key={group.ticketKey ?? group.latest.id}
                group={group}
                onTitleClick={handleTitleClick}
                onMarkRead={handleMarkRead}
              />
            ))}
          </div>

          {totalResults > 0 && (
            <nav className="pager" aria-label="Notifications pagination">
              <div className="pager__meta" aria-live="polite" aria-atomic="true">
                Showing {rangeStart}–{rangeEnd} of {totalResults}
                {totalPages > 1 ? (
                  <span className="of">Page {page} of {totalPages}</span>
                ) : null}
              </div>

              <div className="pager__controls">
                <button
                  type="button"
                  className="pagebtn"
                  aria-label="Previous page"
                  disabled={page <= 1 || isLoading}
                  onClick={() => setPage(page - 1)}
                >
                  Prev
                </button>

                <div className="pager__pages" role="group" aria-label="Page numbers">
                  {pageNumbers.map((item, index) => (
                    typeof item === 'number' ? (
                      <button
                        key={item}
                        type="button"
                        className="pagebtn"
                        aria-label={`Page ${item}`}
                        aria-current={item === page ? 'page' : undefined}
                        disabled={isLoading}
                        onClick={() => setPage(item)}
                      >
                        {item}
                      </button>
                    ) : (
                      <span key={`gap-${index}-${item}`} className="of pager__gap" aria-hidden="true">
                        {item}
                      </span>
                    )
                  ))}
                </div>

                <button
                  type="button"
                  className="pagebtn"
                  aria-label="Next page"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
