'use client';

import { useState } from 'react';
import { SEVERITIES, PRIORITIES } from '@pms/shared';

const dateValue = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

export default function TicketFields({
  ticket, onSave, onBlock, onUnblock, blockReason, setBlockReason,
}) {
  const [draft, setDraft] = useState({
    priority: ticket.priority || '',
    severity: ticket.severity || '',
    estimatedResolutionAt: dateValue(ticket.estimatedResolutionAt),
    expectedReleaseDate: dateValue(ticket.expectedReleaseDate),
  });

  const set = (key) => (event) => setDraft({ ...draft, [key]: event.target.value });

  return (
    <aside className="sidecol">
      <h2>Details</h2>
      <div className="siderow">
        <span className="lbl">Description</span>
        <p className="meta">{ticket.description || 'No description.'}</p>
      </div>

      <div className="siderow">
        <label className="lbl" htmlFor="priority">Priority</label>
        <select id="priority" value={draft.priority} onChange={set('priority')}>
          <option value="">—</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="siderow">
        <label className="lbl" htmlFor="severity">Severity</label>
        <select id="severity" value={draft.severity} onChange={set('severity')}>
          <option value="">—</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="siderow">
        <label className="lbl" htmlFor="estimatedResolutionAt">Estimated resolution</label>
        <input id="estimatedResolutionAt" type="date"
          value={draft.estimatedResolutionAt} onChange={set('estimatedResolutionAt')} />
      </div>

      <div className="siderow">
        <label className="lbl" htmlFor="expectedReleaseDate">Expected release</label>
        <input id="expectedReleaseDate" type="date"
          value={draft.expectedReleaseDate} onChange={set('expectedReleaseDate')} />
      </div>

      <div className="siderow">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onSave({
            revision: ticket.revision,
            priority: draft.priority || undefined,
            severity: draft.severity || undefined,
            estimatedResolutionAt: draft.estimatedResolutionAt || null,
            expectedReleaseDate: draft.expectedReleaseDate || null,
          })}
        >
          Save fields
        </button>
      </div>

      <div className="siderow">
        <span className="lbl">Blocked</span>
        {ticket.blocked ? (
          <button type="button" className="btn btn-sm" onClick={onUnblock}>Clear blocker</button>
        ) : (
          <>
            <textarea
              rows={2}
              placeholder="Why is this blocked?"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
            />
            <button type="button" className="btn btn-sm" onClick={onBlock} disabled={!blockReason.trim()}>
              Mark blocked
            </button>
          </>
        )}
      </div>

      <div className="siderow">
        <span className="lbl">Reporter</span>
        <p className="meta">{ticket.createdBy?.name || '—'}</p>
      </div>
      <div className="siderow">
        <span className="lbl">Assignee</span>
        <p className="meta">{ticket.assignedTo?.name || 'Unassigned'}</p>
      </div>
      <div className="siderow">
        <span className="lbl">Team</span>
        <p className="meta">{ticket.team?.name || '—'}</p>
      </div>
    </aside>
  );
}
