'use client';

import { laneEntryStage, stageLabel } from '@pms/shared';
import TicketCard from './ticket-card.jsx';

const EMPTY = {
  intake: 'Nothing waiting for triage.',
  development: 'No active development work.',
  qa: 'QA is clear.',
  release: 'Nothing ready to ship.',
  done: 'Nothing closed yet.',
};

export default function BoardLane({
  lane,
  tickets,
  onOpen,
  onDropTicket,
  canDrop = true,
  canDragTicket,
  onBlockedDrag,
}) {
  function handleDrop(event) {
    event.preventDefault?.();
    event.currentTarget.classList.remove('dropping');
    if (!canDrop) return;
    const ticketId = event.dataTransfer.getData('text/plain');
    if (ticketId) onDropTicket(ticketId, laneEntryStage(lane.key));
  }

  return (
    <section
      className={`lane${canDrop ? '' : ' lane-locked'}`}
      data-testid={`lane-${lane.key}`}
      aria-label={lane.label}
      onDragOver={(e) => {
        if (!canDrop) return;
        e.preventDefault();
        e.currentTarget.classList.add('dropping');
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove('dropping')}
      onDrop={handleDrop}
    >
      <div className="lane-head">
        <h3>{lane.label}</h3>
        <span className="n">{tickets.length}</span>
      </div>
      <p className="lane-stages">{lane.stages.map(stageLabel).join(' · ')}</p>
      <div className="lane-stack">
        {tickets.length === 0
          ? <p className="lane-empty">{EMPTY[lane.key] || 'Empty'}</p>
          : tickets.map((ticket) => (
            <TicketCard
              key={ticket.id || ticket.ticketId}
              ticket={ticket}
              onOpen={onOpen}
              draggable={canDragTicket ? canDragTicket(ticket) : true}
              onBlockedDrag={onBlockedDrag}
            />
          ))}
      </div>
    </section>
  );
}
