'use client';

import { stageLabel } from '@pms/shared';

export default function TicketCard({ ticket, onOpen }) {
  return (
    <article
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', ticket.ticketId)}
      onClick={() => onOpen(ticket.ticketId)}
      style={{
        border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginBottom: 8,
        background: 'var(--bg)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{ticket.ticketId}</strong>
        {ticket.blocked && <span title="Blocked">⛔</span>}
      </div>
      <div>{ticket.title}</div>
      {/* The EXACT stage, always — five lanes collapse ten stages, and the card
          is where that detail has to survive. */}
      <small style={{ color: 'var(--muted)' }}>{stageLabel(ticket.status)}</small>
    </article>
  );
}
