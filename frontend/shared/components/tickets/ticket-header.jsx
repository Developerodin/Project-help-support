'use client';

import Link from 'next/link';
import Icon, { priorityChipClass, priorityLabel, isOverdue } from '../icons.jsx';

export default function TicketHeader({ ticket, watching, onClose, onToggleWatch }) {
  return (
    <>
      <div className="drawer-id">
        <span className="id">{ticket.ticketId}</span>
        <span className={priorityChipClass(ticket.priority)}>{priorityLabel(ticket.priority)}</span>
        {ticket.severity && <span className="chip">{ticket.severity}</span>}
        {ticket.module && <span className="chip">{ticket.module}</span>}
        <span className="spacer" />
        <span className="acts">
          <Link
            href={`/tickets/${encodeURIComponent(ticket.ticketId)}/edit`}
            className="btn btn-sm"
          >
            Edit
          </Link>
          <button
            type="button"
            className={`btn btn-sm${watching ? ' chip-on' : ''}`}
            aria-pressed={watching}
            onClick={onToggleWatch}
          >
            <Icon name="eye" size={12} /> {watching ? 'Watching' : 'Watch'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-ico" onClick={onClose} aria-label="Close ticket">
            <Icon name="x" size={13} />
          </button>
        </span>
      </div>
      <h2>{ticket.title}</h2>
      {(ticket.blocked || ticket.reopenCount > 0 || isOverdue(ticket)) && (
        <div className="drawer-flags">
          {ticket.blocked && <span className="chip chip-blocked">Blocked</span>}
          {ticket.reopenCount > 0 && (
            <span className="chip chip-reopen">Reopened ×{ticket.reopenCount}</span>
          )}
          {isOverdue(ticket) && !ticket.blocked && (
            <span className="chip chip-late">Late</span>
          )}
        </div>
      )}
    </>
  );
}
