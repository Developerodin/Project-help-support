'use client';

import { stageLabel } from '@pms/shared';
import Icon, { initials, isOverdue, priorityChipClass, priorityLabel } from '../icons.jsx';

export default function TicketCard({
  ticket, onOpen, draggable = true, canDrag = true, onBlockedDrag,
  moveTargets = [], onMoveTo,
}) {
  const late = isOverdue(ticket);
  const assigneeName = ticket.assignedTo?.name;
  const allowedMoves = moveTargets.filter((target) => !target.blocked);
  const showMove = Boolean(onMoveTo) && allowedMoves.length > 0;

  return (
    <div className="card-shell">
      <button
        type="button"
        className={`card${canDrag ? '' : ' card-locked'}`}
        draggable={draggable}
        aria-label={`Open ticket ${ticket.ticketId}: ${ticket.title}`}
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
          <span
            className={`avatar sm${assigneeName ? '' : ' none'}`}
            aria-label={assigneeName || 'Unassigned'}
          >
            {assigneeName ? initials(assigneeName) : '—'}
          </span>
        </div>
      </button>
      {showMove && (
        <label className="card-move">
          <span className="sr">Move {ticket.ticketId} to lane</span>
          <select
            defaultValue=""
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const to = e.target.value;
              if (!to) return;
              onMoveTo(ticket.ticketId, to);
              e.target.value = '';
            }}
          >
            <option value="" disabled>Move to…</option>
            {allowedMoves.map((target) => (
              <option key={target.laneKey} value={target.to}>{target.label}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
