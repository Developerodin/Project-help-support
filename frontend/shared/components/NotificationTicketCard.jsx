'use client';

import { useState } from 'react';
import Link from 'next/link';
import NotificationUpdateRow from '@/shared/components/NotificationUpdateRow.jsx';
import {
  groupHasUnread,
  notificationGroupHref,
  notificationTicketObjectId,
  sumNotificationUpdates,
  ticketSubjectFromGroup,
  visibleUpdates,
} from '@/shared/lib/notification-utils.js';
import { muteTicketWithUndo } from '@/shared/lib/ticket-notification-settings.js';

export default function NotificationTicketCard({
  group,
  onTitleClick,
  onViewTicket,
  onMarkRead,
  markForYou = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const { ticketKey, items } = group;
  // Updates, not rows: a row can hold several updates the server merged.
  const count = sumNotificationUpdates(items);
  const unreadInGroup = groupHasUnread(items);
  const unreadCount = sumNotificationUpdates(items.filter((item) => !item.readAt));
  const project = group.latest?.project;
  const subject = ticketSubjectFromGroup(group);
  const ticketHref = notificationGroupHref(group);
  const { visible } = visibleUpdates(items, expanded);
  const hiddenCount = sumNotificationUpdates(items.slice(visible.length));
  const ticketObjectId = notificationTicketObjectId(group.latest);

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
          {project?.key ? (
            <span className="chip chip-sm notif-chip--neutral" title={project.name}>{project.key}</span>
          ) : null}
          {count > 1 || unreadCount > 0 ? (
            <span className="notif-ticket-card__badge">
              {count > 1 ? `${count} updates` : null}
              {count > 1 && unreadCount > 0 ? ' · ' : null}
              {unreadCount > 0 ? `${unreadCount} unread` : null}
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
            markForYou={markForYou}
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
          {ticketObjectId ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label={`Mute ${ticketKey || 'this ticket'}`}
              onClick={() => muteTicketWithUndo(ticketObjectId, ticketKey)}
            >
              Mute ticket
            </button>
          ) : null}
          <Link href={ticketHref} className="notif-ticket-card__view" onClick={
            onViewTicket ? (event) => onViewTicket(event, group) : undefined
          }>
            View ticket →
          </Link>
        </footer>
      </div>
    </article>
  );
}
