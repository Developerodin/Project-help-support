'use client';

import { useState } from 'react';
import Link from 'next/link';
import NotificationUpdateRow from '@/shared/components/NotificationUpdateRow.jsx';
import {
  groupHasUnread,
  notificationGroupHref,
  ticketSubjectFromGroup,
  visibleUpdates,
} from '@/shared/lib/notification-utils.js';

export default function NotificationTicketCard({
  group,
  onTitleClick,
  onMarkRead,
}) {
  const [expanded, setExpanded] = useState(false);
  const { ticketKey, items } = group;
  const count = items.length;
  const unreadInGroup = groupHasUnread(items);
  const subject = ticketSubjectFromGroup(group);
  const ticketHref = notificationGroupHref(group);
  const { visible, hiddenCount } = visibleUpdates(items, expanded);

  const cardClass = [
    'notif-ticket-card',
    unreadInGroup ? 'has-unread' : 'is-read',
  ].join(' ');

  return (
    <article className={cardClass} role="listitem">
      <header className="notif-ticket-card__head">
        <div className="notif-ticket-card__id-row">
          {unreadInGroup ? (
            <span className="notif-ticket-card__dot" aria-hidden="true" />
          ) : null}
          {ticketKey ? (
            <span className="notif-ticket-card__key">{ticketKey}</span>
          ) : (
            <span className="notif-ticket-card__key notif-ticket-card__key--muted">Update</span>
          )}
          {count > 1 ? (
            <span className="notif-ticket-card__badge">
              {count} update{count === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
        {subject ? (
          <p className="notif-ticket-card__subject">{subject}</p>
        ) : null}
      </header>

      <div className="notif-ticket-card__updates">
        {visible.map((item) => (
          <NotificationUpdateRow
            key={item.id}
            item={item}
            showMarkRead
            onNavigate={onTitleClick}
            onMarkRead={onMarkRead}
          />
        ))}
      </div>

      <div className="notif-ticket-card__actions">
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="notif-ticket-card__more"
            onClick={() => setExpanded(true)}
          >
            + {hiddenCount} more update{hiddenCount === 1 ? '' : 's'}
          </button>
        ) : null}

        <footer className="notif-ticket-card__foot">
          <Link href={ticketHref} className="notif-ticket-card__view" onClick={
            onTitleClick
              ? (event) => onTitleClick(event, group.latest ?? items[0])
              : undefined
          }>
            View ticket →
          </Link>
        </footer>
      </div>
    </article>
  );
}
