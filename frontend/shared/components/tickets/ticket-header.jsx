'use client';

export default function TicketHeader({ ticket, onClose }) {
  return (
    <header style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <strong style={{ fontSize: 18 }}>{ticket.ticketId}</strong>
      <span>{ticket.title}</span>
      <button type="button" onClick={onClose} style={{ marginLeft: 'auto' }} aria-label="Close">
        Close
      </button>
    </header>
  );
}
