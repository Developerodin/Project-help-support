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

function formatChangeLine(change) {
  const { label, from, to } = change;
  if (from && to) return `${label}: ${from} → ${to}`;
  if (to) return `${label}: ${to}`;
  if (from) return `${label}: cleared`;
  return label;
}

function EventRow({ event, onOpenDiscussion }) {
  const [open, setOpen] = useState(false);
  const expandable = event.changes?.length > 0;

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
          {event.commentPreview && (
            <span className="trail-preview"> — {event.commentPreview}</span>
          )}
          <span aria-hidden="true"> ↗</span>
          <span className="sr"> — open in Discussion</span>
        </button>
      ) : expandable ? (
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

      {expandable && open && (
        <ul className="trail-rolled">
          {event.changes.map((change, index) => (
            <li key={`${change.label}-${index}`}>{formatChangeLine(change)}</li>
          ))}
        </ul>
      )}

      {event.detail && <p className="note">{event.detail}</p>}
    </li>
  );
}

export default function TicketHistory({ ticket, activityFeed, onOpenDiscussion }) {
  const feed = activityFeed ?? buildActivityFeed(ticket);

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
