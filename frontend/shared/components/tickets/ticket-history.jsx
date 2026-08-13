'use client';

import { stageLabel } from '@pms/shared';

export default function TicketHistory({ ticket }) {
  return (
    <section>
      <h2>History</h2>
      <ol className="trail">
        {ticket.stageHistory.map((entry) => (
          <li key={entry._id || entry.id || `${entry.to}-${entry.at}`} className="trail-item">
            <strong>
              {entry.from ? `${stageLabel(entry.from)} → ` : ''}{stageLabel(entry.to)}
            </strong>
            <span className="meta">
              {entry.by?.name || 'Someone'} · {new Date(entry.at).toLocaleString()}
              {entry.decision ? ` · ${entry.decision}` : ''}
            </span>
            {entry.note && <p className="meta">{entry.note}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
