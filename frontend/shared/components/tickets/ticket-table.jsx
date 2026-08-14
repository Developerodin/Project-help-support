'use client';

import { STAGES, stageIndex, stageLabel } from '@pms/shared';
import { initials, isOverdue } from '../icons.jsx';

function stageAgeDays(ticket) {
  const last = ticket.stageHistory?.[ticket.stageHistory.length - 1]?.at || ticket.updatedAt || ticket.createdAt;
  return Math.max(0, Math.floor((Date.now() - new Date(last).getTime()) / 86400000));
}

function Rail({ ticket }) {
  const current = stageIndex(ticket.status);
  return (
    <div className="rail rail-xs" aria-hidden="true">
      {STAGES.map((stage) => (
        <i
          key={stage.key}
          className={
            stage.index < current ? 'done'
              : stage.index === current ? 'now'
                : ''
          }
        />
      ))}
    </div>
  );
}

export default function TicketTable({ tickets, onOpen }) {
  if (tickets.length === 0) {
    return (
      <div className="empty-state">
        <h3>No ticket matches those filters</h3>
        <p>Clear the stage or scope filter first — those usually do the narrowing.</p>
      </div>
    );
  }

  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Title</th>
            <th scope="col">Pipeline</th>
            <th scope="col">Stage</th>
            <th scope="col">Owner</th>
            <th scope="col">In stage</th>
            <th scope="col">Est. done</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => {
            const late = isOverdue(ticket);
            return (
              <tr
                key={ticket.id || ticket.ticketId}
                data-click
                tabIndex={0}
                onClick={() => onOpen(ticket.ticketId)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpen(ticket.ticketId); }}
              >
                <td className="t-id">{ticket.ticketId}</td>
                <td className="t-title">
                  <span className="titleflex">
                    {(ticket.blocked || late || ticket.reopenCount > 0) && (
                      <span className="rowflags">
                        {ticket.blocked && <span className="chip chip-blocked">Blocked</span>}
                        {late && <span className="chip chip-late">Overdue</span>}
                        {ticket.reopenCount > 0 && <span className="chip chip-reopen">Reopened</span>}
                      </span>
                    )}
                    <span className="tt">{ticket.title}</span>
                  </span>
                </td>
                <td><Rail ticket={ticket} /></td>
                <td className="t-stage">{stageLabel(ticket.status)}</td>
                <td>
                  <span className={`avatar sm${ticket.assignedTo ? '' : ' none'}`}>
                    {ticket.assignedTo ? initials(ticket.assignedTo.name) : '—'}
                  </span>
                </td>
                <td className="t-num">{stageAgeDays(ticket)}d</td>
                <td className={`t-num${late ? ' late' : ''}`}>
                  {ticket.estimatedResolutionAt
                    ? new Date(ticket.estimatedResolutionAt).toLocaleDateString()
                    : <span className="dash">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
