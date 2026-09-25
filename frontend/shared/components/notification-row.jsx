'use client';

import Link from 'next/link';
import Icon from '@/shared/components/icons.jsx';
import {
  formatAbsoluteTime,
  formatRelativeTime,
  notificationActivityAt,
  notificationChipLabel,
  notificationEventChipClass,
  notificationEventIconName,
  notificationHref,
  notificationPrimaryLine,
  notificationUpdateCount,
} from '@/shared/lib/notification-utils.js';

/**
 * Shared notification row for bell dropdown and inbox.
 * @param {'link'|'static'} as - link wraps primary in Next Link (bell); static uses plain heading (inbox group child)
 * @param {boolean} markForYou - tag rows meant for this person (used where other rows are mixed in)
 */
export default function NotificationRow({
  item,
  as = 'link',
  className = '',
  bodyLines = 1,
  onNavigate,
  onMarkRead,
  showMarkRead = false,
  markForYou = false,
}) {
  const unread = !item.readAt;
  const href = notificationHref(item.link);
  const primary = notificationPrimaryLine(item);
  const chipLabel = notificationChipLabel(item);
  const body = item.body?.trim() ?? '';
  const activityAt = notificationActivityAt(item);
  const updates = notificationUpdateCount(item);

  const rowClass = [
    'notif-row',
    unread ? 'unread' : 'read',
    bodyLines === 1 ? 'notif-row--one-line-body' : '',
    className,
  ].filter(Boolean).join(' ');

  const titleInner = (
    <span className="notif-row__title-text">
      {unread ? <span className="sr-only">Unread: </span> : null}
      {primary}
    </span>
  );

  const titleNode = as === 'link' ? (
    <Link
      href={href}
      className="notif-row__title"
      onClick={onNavigate ? (event) => onNavigate(event, item) : undefined}
    >
      {titleInner}
    </Link>
  ) : (
    <p className="notif-row__title notif-row__title--static">{titleInner}</p>
  );

  return (
    <div className={rowClass}>
      <div className="notif-row__main">
        {unread ? <span className="notif-row__dot" aria-hidden="true" /> : null}
        {titleNode}
        {body ? (
          <p className="notif-row__body" title={body}>{body}</p>
        ) : null}
        <p className="notif-row__meta meta">
          {markForYou && item.forYou ? (
            <>
              <span className="chip chip-sm notif-chip--sig">For you</span>
              <span className="notif-row__meta-sep" aria-hidden="true"> · </span>
            </>
          ) : null}
          {item.project?.key ? (
            <>
              <span className="chip chip-sm notif-chip--neutral" title={item.project.name}>
                {item.project.key}
              </span>
              <span className="notif-row__meta-sep" aria-hidden="true"> · </span>
            </>
          ) : null}
          {chipLabel ? (
            <>
              <span className={`chip chip-sm notif-row__event ${notificationEventChipClass(item.event)}`}>
                <Icon name={notificationEventIconName(item.event)} size={11} aria-hidden="true" />
                {chipLabel}
              </span>
              <span className="notif-row__meta-sep" aria-hidden="true"> · </span>
            </>
          ) : null}
          <time dateTime={activityAt} title={formatAbsoluteTime(activityAt)}>
            {formatRelativeTime(activityAt)}
          </time>
          {updates > 1 ? (
            <>
              <span className="notif-row__meta-sep" aria-hidden="true"> · </span>
              <span>{updates} updates</span>
            </>
          ) : null}
        </p>
      </div>
      {showMarkRead && unread && onMarkRead ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost notif-row__mark-read"
          aria-label={`Mark read: ${primary}`}
          onClick={() => onMarkRead(item.id)}
        >
          Mark read
        </button>
      ) : null}
    </div>
  );
}
