'use client';

import { stageLabel } from '@pms/shared';
import Icon, { initials, isOverdue, priorityChipClass, priorityLabel } from '../icons.jsx';

export default function TicketCard({
  ticket, onOpen, draggable = true, canDrag = true, onBlockedDrag,
}) {
  const late = isOverdue(ticket);

  return (
    <button
      type="button"
      className={`card${canDrag ? '' : ' card-locked'}`}
      draggable={draggable}
      onDragStart={(e) => {
        if (!canDrag) {
          e.preventDefault();
          onBlockedDrag?.(ticket);
          return;
        }
        e.dataTransfer.setData('text/plain', ticket.ticketId);
        e.currentTarget.classList.add('dragging');
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove('dragging')}
      onClick={() => onOpen(ticket.ticketId)}
    >
      <div className="card-top">
        <span className="card-id">{ticket.ticketId}</span>
        <span className="spacer" />
        <span className={priorityChipClass(ticket.priority)}>{priorityLabel(ticket.priority)}</span>
      </div>
      <h4>{ticket.title}</h4>
      {(ticket.blocked || late || ticket.reopenCount > 0) && (
        <div className="card-flags">
          {ticket.blocked && <span className="chip chip-blocked">Blocked</span>}
          {late && <span className="chip chip-late">Overdue</span>}
          {ticket.reopenCount > 0 && <span className="chip chip-reopen">Reopened</span>}
        </div>
      )}
      <div className="card-foot">
        <span className="card-stage">{stageLabel(ticket.status)}</span>
        <span className="spacer" />
        {(ticket.attachments?.length > 0) && (
          <span className="card-count"><Icon name="clip" size={11} />{ticket.attachments.length}</span>
        )}
        {(ticket.comments?.length > 0) && (
          <span className="card-count"><Icon name="msg" size={11} />{ticket.comments.length}</span>
        )}
        <span className={`avatar sm${ticket.assignedTo ? '' : ' none'}`}>
          {ticket.assignedTo ? initials(ticket.assignedTo.name) : '—'}
        </span>
      </div>
    </button>
  );
}
