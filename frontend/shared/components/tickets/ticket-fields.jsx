'use client';

import { useState } from 'react';
import { SEVERITIES, PRIORITIES } from '@pms/shared';

const dateValue = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

export default function TicketFields({ ticket, onSave }) {
  const [draft, setDraft] = useState({
    priority: ticket.priority || '',
    severity: ticket.severity || '',
    estimatedResolutionAt: dateValue(ticket.estimatedResolutionAt),
    expectedReleaseDate: dateValue(ticket.expectedReleaseDate),
  });

  const set = (key) => (event) => setDraft({ ...draft, [key]: event.target.value });

  return (
    <section>
      <h2>Details</h2>
      <p>{ticket.description || 'No description.'}</p>

      <label htmlFor="priority">Priority</label>
      <select id="priority" value={draft.priority} onChange={set('priority')}>
        <option value="">—</option>
        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>

      <label htmlFor="severity">Severity</label>
      <select id="severity" value={draft.severity} onChange={set('severity')}>
        <option value="">—</option>
        {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      {/* Both are required to enter any stage from In Progress onward, so they
          are first-class fields rather than something buried in a modal. */}
      <label htmlFor="estimatedResolutionAt">Estimated resolution</label>
      <input id="estimatedResolutionAt" type="date"
        value={draft.estimatedResolutionAt} onChange={set('estimatedResolutionAt')} />

      <label htmlFor="expectedReleaseDate">Expected release</label>
      <input id="expectedReleaseDate" type="date"
        value={draft.expectedReleaseDate} onChange={set('expectedReleaseDate')} />

      <button
        type="button"
        onClick={() => onSave({
          revision: ticket.revision,
          priority: draft.priority || undefined,
          severity: draft.severity || undefined,
          estimatedResolutionAt: draft.estimatedResolutionAt || null,
          expectedReleaseDate: draft.expectedReleaseDate || null,
        })}
      >
        Save
      </button>
    </section>
  );
}
