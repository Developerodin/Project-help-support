'use client';

import Link from 'next/link';
import Icon from '@/shared/components/icons.jsx';
import {
  formatAbsoluteTime,
  formatRelativeTime,
  notificationActivityAt,
  notificationChipLabel,
  notificationEventIconName,
  notificationHref,
  notificationPrimaryLine,
  notificationUpdateCount,
  notificationUpdateDescription,
} from '@/shared/lib/notification-utils.js';

export default function NotificationUpdateRow({
  item,
  onNavigate,
  onMarkRead,
  showMarkRead = false,
  markForYou = false,
}) {
  const unread = !item.readAt;
  const href = notificationHref(item.link);
  const title = notificationPrimaryLine(item);
  const description = notificationUpdateDescription(item) ?? notificationChipLabel(item);
  const activityAt = notificationActivityAt(item);
  const updates = notificationUpdateCount(item);

  const rowClass = [
    'notif-update-row',
    unread ? 'is-unread' : 'is-read',
  ].join(' ');

  return (
    <div className={rowClass}>
      <span className="notif-update-row__icon" aria-hidden="true">
        <Icon name={notificationEventIconName(item.event)} size={14} />
      </span>
      <div className="notif-update-row__main">
        <Link
          href={href}
          className="notif-update-row__title"
          onClick={onNavigate ? (event) => onNavigate(event, item) : undefined}
        >
          {unread ? <span className="sr-only">Unread: </span> : null}
          {title}
        </Link>
        <span className="notif-update-row__time meta">
          {markForYou && item.forYou ? (
            <>
              <span className="chip chip-sm notif-chip--sig">For you</span>
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          <time dateTime={activityAt} title={formatAbsoluteTime(activityAt)}>
            {formatRelativeTime(activityAt)}
          </time>
          {updates > 1 ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>{updates} updates</span>
            </>
          ) : null}
        </span>
        {description ? (
          <p className="notif-update-row__desc meta">{description}</p>
        ) : null}
      </div>
      {showMarkRead && unread && onMarkRead ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost notif-update-row__mark-read"
          aria-label={`Mark read: ${title}`}
          onClick={() => onMarkRead(item.id)}
        >
          Mark read
        </button>
      ) : null}
    </div>
  );
}
