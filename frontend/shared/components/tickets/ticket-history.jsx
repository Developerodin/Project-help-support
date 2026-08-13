'use client';

import { stageIndex, stageLabel } from '@pms/shared';

function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TicketHistory({ ticket }) {
  const history = ticket.stageHistory ?? [];

  if (history.length === 0) {
    return (
      <section aria-label="History">
        <p className="meta">No stage changes recorded yet.</p>
      </section>
    );
  }

  return (
    <section aria-label="History">
      <ol className="trail">
        {history.map((entry) => {
          const isReopen = entry.from && stageIndex(entry.from) > stageIndex(entry.to);
          const cls = ['trail-item', 'stage', isReopen ? 'reopen' : ''].filter(Boolean).join(' ');
          return (
            <li key={entry._id || entry.id || `${entry.to}-${entry.at}`} className={cls}>
              <div className="h">
                {entry.from ? `${stageLabel(entry.from)} → ` : ''}
                <b>{stageLabel(entry.to)}</b>
              </div>
              <span className="when">
                {entry.by?.name || 'Someone'}
                {' · '}
                {formatWhen(entry.at)}
                {entry.decision ? ` · ${entry.decision}` : ''}
              </span>
              {entry.note && <p className="note">{entry.note}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
