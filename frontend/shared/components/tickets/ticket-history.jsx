'use client';

import { useState } from 'react';
import { buildActivityFeed } from './ticket-activity.js';
import { formatWhen } from './ticket-drawer-utils.js';

function dayKey(iso) {
  if (!iso) return 'Undated';
  const then = new Date(iso);
  const today = new Date();
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(then, today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(then, yesterday)) return 'Yesterday';
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function clockOf(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function groupByDay(events) {
  const groups = [];
  for (const event of events) {
    const key = dayKey(event.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(event);
    else groups.push({ key, events: [event] });
  }
  return groups;
}

function EventRow({ event, onOpenDiscussion }) {
  const [open, setOpen] = useState(false);
  const rolled = event.collapsed?.length ? event.collapsed : null;

  return (
    <li className={`trail-item trail-item--${event.kind}`}>
      <div className="trail-line">
        <span className="trail-actor">{event.actor.name}</span>
        {event.at && (
          <time className="when" dateTime={event.at} title={formatWhen(event.at)}>
            {clockOf(event.at)}
          </time>
        )}
      </div>

      {event.href === 'discussion' ? (
        <button type="button" className="trail-summary trail-jump" onClick={onOpenDiscussion}>
          {event.summary}
          <span aria-hidden="true"> ↗</span>
          <span className="sr"> — open in Discussion</span>
        </button>
      ) : rolled ? (
        <button
          type="button"
          className="trail-summary trail-jump"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {event.summary}
          <span aria-hidden="true">{open ? ' ▾' : ' ▸'}</span>
        </button>
      ) : (
        <p className="trail-summary">{event.summary}</p>
      )}

      {rolled && open && (
        <ul className="trail-rolled">
          {rolled.map((child) => <li key={child.id}>{child.summary}</li>)}
        </ul>
      )}

      {event.detail && <p className="note">{event.detail}</p>}
    </li>
  );
}

export default function TicketHistory({ ticket, onOpenDiscussion }) {
  const feed = buildActivityFeed(ticket);

  if (feed.length === 0) {
    return (
      <section className="history-tab" aria-label="History">
        <p className="meta">No activity to show.</p>
      </section>
    );
  }

  return (
    <section className="history-tab" aria-label="History">
      {groupByDay(feed).map((group) => (
        <div key={group.key} className="trail-group">
          <h3 className="trail-day">{group.key}</h3>
          <ol className="trail">
            {group.events.map((event) => (
              <EventRow key={event.id} event={event} onOpenDiscussion={onOpenDiscussion} />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
