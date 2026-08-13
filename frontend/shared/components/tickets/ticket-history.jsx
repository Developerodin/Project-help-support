'use client';

import { stageLabel } from '@pms/shared';

export default function TicketHistory({ ticket }) {
  return (
    <section>
      <h2>History</h2>
      <ol style={{ listStyle: 'none', padding: 0 }}>
        {ticket.stageHistory.map((entry) => (
          <li key={entry._id || entry.id || `${entry.to}-${entry.at}`}>
            <strong>
              {entry.from ? `${stageLabel(entry.from)} → ` : ''}{stageLabel(entry.to)}
            </strong>
            {' · '}{entry.by?.name || 'Someone'}
            {' · '}{new Date(entry.at).toLocaleString()}
            {entry.decision && ` · ${entry.decision}`}
            {entry.note && <div style={{ color: 'var(--muted)' }}>{entry.note}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
