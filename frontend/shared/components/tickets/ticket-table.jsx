'use client';

import { STAGES, stageIndex, stageLabel, sortAriaValue } from '@pms/shared';
import { initials, isOverdue } from '../icons.jsx';

function stageAgeDays(ticket) {
  const entered = ticket.currentStageEnteredAt
    || ticket.stageHistory?.[ticket.stageHistory.length - 1]?.at
    || ticket.updatedAt
    || ticket.createdAt;
  return Math.max(0, Math.floor((Date.now() - new Date(entered).getTime()) / 86400000));
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

const SORTABLE_COLUMNS = [
  { key: 'ticketId', label: 'Ticket' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Stage' },
  { key: 'owner', label: 'Owner' },
  { key: 'inStage', label: 'In stage' },
  { key: 'estimatedDone', label: 'Est. done' },
];

function SortHeader({ column, sort, onSort }) {
  const ariaSort = sortAriaValue(sort, column.key);
  const active = sort?.column === column.key && sort?.direction;
  const sortLabel = active
    ? `Sort by ${column.label}, ${sort.direction === 'asc' ? 'ascending' : 'descending'}`
    : `Sort by ${column.label}`;
  return (
    <th scope="col" className="sortable" aria-sort={ariaSort}>
      <button type="button" onClick={() => onSort(column.key)} aria-label={sortLabel}>
        <span>{column.label}</span>
        <span className="arrow" aria-hidden="true">↓</span>
      </button>
    </th>
  );
}

export default function TicketTable({ tickets, onOpen, sort, onSort, busy = false }) {
  return (
    <div className="tablewrap" data-busy={busy ? 'true' : undefined} aria-busy={busy || undefined}>
      <table>
        <thead>
          <tr>
            <SortHeader column={SORTABLE_COLUMNS[0]} sort={sort} onSort={onSort} />
            <SortHeader column={SORTABLE_COLUMNS[1]} sort={sort} onSort={onSort} />
            <th scope="col">Pipeline</th>
            <SortHeader column={SORTABLE_COLUMNS[2]} sort={sort} onSort={onSort} />
            <SortHeader column={SORTABLE_COLUMNS[3]} sort={sort} onSort={onSort} />
            <SortHeader column={SORTABLE_COLUMNS[4]} sort={sort} onSort={onSort} />
            <SortHeader column={SORTABLE_COLUMNS[5]} sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => {
            const late = isOverdue(ticket);
            const rowLabel = `Open ticket ${ticket.ticketId}: ${ticket.title}`;
            const ownerName = ticket.assignedTo?.name;
            return (
              <tr
                key={ticket.id || ticket.ticketId}
                data-click
                tabIndex={0}
                aria-label={rowLabel}
                onClick={() => onOpen(ticket.ticketId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(ticket.ticketId);
                  }
                }}
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
                  <span
                    className={`avatar sm${ownerName ? '' : ' none'}`}
                    aria-label={ownerName ? `Owner: ${ownerName}` : 'Unassigned'}
                  >
                    {ownerName ? initials(ownerName) : '—'}
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
