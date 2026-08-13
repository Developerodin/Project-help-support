'use client';

import { laneEntryStage } from '@pms/shared';
import TicketCard from './ticket-card.jsx';

export default function BoardLane({ lane, tickets, onOpen, onDropTicket }) {
  function handleDrop(event) {
    event.preventDefault?.();
    const ticketId = event.dataTransfer.getData('text/plain');
    // Dropping into a lane transitions to that lane's FIRST stage. The server
    // re-checks it; a refusal comes back with its reason.
    if (ticketId) onDropTicket(ticketId, laneEntryStage(lane.key));
  }

  return (
    <section
      data-testid={`lane-${lane.key}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      style={{
        flex: 1, minWidth: 220, padding: 8,
        border: '1px solid var(--border)', borderRadius: 6,
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong>{lane.label}</strong>
        <span>{tickets.length}</span>
      </header>

      {tickets.map((ticket) => (
        <TicketCard key={ticket.id} ticket={ticket} onOpen={onOpen} />
      ))}
    </section>
  );
}
