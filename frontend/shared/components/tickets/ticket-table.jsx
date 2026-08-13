'use client';

import { stageLabel } from '@pms/shared';

const ageDays = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

export default function TicketTable({ tickets, onOpen }) {
  if (tickets.length === 0) return <p>No tickets match these filters.</p>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['ID', 'Title', 'Stage', 'Priority', 'Assignee', 'Age'].map((h) => (
            <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tickets.map((ticket) => (
          <tr key={ticket.id}>
            <td>
              <button type="button" onClick={() => onOpen(ticket.ticketId)}>
                {ticket.ticketId}
              </button>
            </td>
            <td>{ticket.title}</td>
            <td>{stageLabel(ticket.status)}</td>
            <td>{ticket.priority || '—'}</td>
            <td>{ticket.assignedTo?.name || 'Unassigned'}</td>
            <td>{ageDays(ticket.createdAt)}d</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
