'use client';

import Link from 'next/link';
import Icon, { initials, priorityChipClass, priorityLabel, isOverdue } from '../icons.jsx';
import { daysBetween, formatDateOnly } from './ticket-drawer-utils.js';

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
      <div className="ctxstrip" role="group" aria-label="Ticket context">
        <span className="ctxstrip__item ctxstrip__item--primary">
          {ticket.assignedTo?.name ? (
            <>
              <span className="avatar sm" title={ticket.assignedTo.name}>
                {initials(ticket.assignedTo.name)}
              </span>
              {ticket.assignedTo.name}
            </>
          ) : <span className="empty">Unassigned</span>}
        </span>
        <span className="ctxstrip__item ctxstrip__item--primary">
          {ticket.team?.name || <span className="empty">No team</span>}
        </span>
        <span className="ctxstrip__item ctxstrip__item--secondary">
          {ticket.estimatedResolutionAt ? (
            <>
              Due {formatDateOnly(ticket.estimatedResolutionAt)}
              <b className={isOverdue(ticket) ? 'late' : ''}>
                {` · ${Math.abs(daysBetween(ticket.estimatedResolutionAt))}d ${isOverdue(ticket) ? 'late' : 'left'}`}
              </b>
            </>
          ) : <span className="empty">No due date</span>}
        </span>
        <span className="ctxstrip__item ctxstrip__item--secondary">
          {`${ticket.watchers?.length || 0} watching`}
        </span>
      </div>
    </>
  );
}
