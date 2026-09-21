'use client';

import { useState } from 'react';
import { laneEntryStage, laneOf, stageLabel } from '@pms/shared';
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
  getMoveTargets,
  canDrop = true,
  canDragTicket,
  onBlockedDrag,
  draggingTicket = null,
  getDropHint,
  movingTicketId = null,
  onDragStartTicket,
  onDragEndTicket,
}) {
  const [dropHint, setDropHint] = useState(null);

  function handleDrop(event) {
    event.preventDefault?.();
    event.currentTarget.classList.remove('dropping');
    setDropHint(null);
    if (!canDrop) return;
    const ticketId = event.dataTransfer.getData('text/plain');
    if (ticketId) onDropTicket(ticketId, laneEntryStage(lane.key));
  }

  function resolveDropHint(ticket) {
    if (!ticket) return null;
    if (laneOf(ticket.status) === lane.key) return 'same-lane';
    return getDropHint?.(ticket, laneEntryStage(lane.key)) ?? null;
  }

  function handleDragOver(event) {
    if (!canDrop) return;
    event.preventDefault();
    const ticket = draggingTicket;
    const hint = resolveDropHint(ticket);
    setDropHint(hint);
    if (hint === 'same-lane') {
      event.currentTarget.classList.remove('dropping');
      return;
    }
    event.currentTarget.classList.add('dropping');
  }

  function handleDragLeave(event) {
    event.currentTarget.classList.remove('dropping');
    setDropHint(null);
  }

  const laneDropClass = dropHint === 'valid'
    ? ' lane-drop-valid'
    : dropHint === 'invalid'
      ? ' lane-drop-invalid'
      : '';

  return (
    <section
      className={`lane${canDrop ? '' : ' lane-locked'}${laneDropClass}`}
      data-testid={`lane-${lane.key}`}
      aria-label={lane.label}
      aria-busy={movingTicketId ? true : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
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
              draggable={canDrop && movingTicketId !== ticket.ticketId}
              canDrag={canDragTicket ? canDragTicket(ticket) : true}
              onBlockedDrag={onBlockedDrag}
              moveTargets={getMoveTargets ? getMoveTargets(ticket) : []}
              onMoveTo={canDrop && movingTicketId !== ticket.ticketId ? onDropTicket : undefined}
              busy={movingTicketId === ticket.ticketId}
              onDragStart={() => onDragStartTicket?.(ticket)}
              onDragEnd={() => onDragEndTicket?.()}
            />
          ))}
      </div>
    </section>
  );
}
