'use client';

import Link from 'next/link';
import { notificationEventLabel } from '@pms/shared';
import Icon from '@/shared/components/icons.jsx';
import {
  formatRelativeTime,
  notificationEffectiveEvent,
  notificationEventIconName,
  notificationHref,
  notificationPrimaryLine,
  notificationUpdateDescription,
} from '@/shared/lib/notification-utils.js';

export default function NotificationUpdateRow({
  item,
  onNavigate,
  onMarkRead,
  showMarkRead = false,
}) {
  const unread = !item.readAt;
  const href = notificationHref(item.link);
  const event = notificationEffectiveEvent(item);
  const title = notificationPrimaryLine(item, { omitTicketKey: true });
  const description = notificationUpdateDescription(item)
    ?? notificationEventLabel(event);

  const rowClass = [
    'notif-update-row',
    unread ? 'is-unread' : 'is-read',
  ].join(' ');

  return (
    <div className={rowClass}>
      <span className="notif-update-row__icon" aria-hidden="true">
        <Icon name={notificationEventIconName(event)} size={14} />
      </span>
      <div className="notif-update-row__main">
        <Link
          href={href}
          className="notif-update-row__title"
          onClick={onNavigate ? (event) => onNavigate(event, item) : undefined}
        >
          {title}
        </Link>
        <time className="notif-update-row__time meta" dateTime={item.createdAt}>
          {formatRelativeTime(item.createdAt)}
        </time>
        {description ? (
          <p className="notif-update-row__desc meta">{description}</p>
        ) : null}
      </div>
      {showMarkRead && unread && onMarkRead ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost notif-update-row__mark-read"
          onClick={() => onMarkRead(item.id)}
        >
          Mark read
        </button>
      ) : null}
    </div>
  );
}
