'use client';

import { useRef, useState } from 'react';
import { SEVERITIES, PRIORITIES } from '@pms/shared';
import { API_URL } from '@/shared/lib/env.js';
import { attachmentDownloadUrl } from '@/shared/api/tickets.js';
import Icon, { initials } from '../icons.jsx';
import { formatFileSize } from '@/shared/lib/attachment-config.js';

const dateValue = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

function PersonLine({ name, empty = 'Unassigned' }) {
  if (!name) return <span className="v empty">{empty}</span>;
  return (
    <span className="personline">
      <span className="avatar sm" title={name}>{initials(name)}</span>
      {name}
    </span>
  );
}

export default function TicketFields({
  ticket, onSave, onBlock, onUnblock, blockReason, setBlockReason, onUpload,
  fieldErrors = {}, onFieldEdit,
}) {
  const uploadRef = useRef(null);
  const [draft, setDraft] = useState({
    priority: ticket.priority || '',
    severity: ticket.severity || '',
    estimatedResolutionAt: dateValue(ticket.estimatedResolutionAt),
    expectedReleaseDate: dateValue(ticket.expectedReleaseDate),
  });

  const set = (key) => (event) => {
    onFieldEdit?.(key);
    setDraft({ ...draft, [key]: event.target.value });
  };

  const estInvalid = Boolean(fieldErrors.estimatedResolutionAt);
  const releaseInvalid = Boolean(fieldErrors.expectedReleaseDate);

  function submitUpload() {
    const files = uploadRef.current?.files;
    if (!files?.length || !onUpload) return;
    const form = new FormData();
    for (const file of files) form.append('files', file);
    form.append('clientRef', crypto.randomUUID());
    onUpload(form);
    uploadRef.current.value = '';
  }

  const attachments = ticket.attachments ?? [];

  return (
    <aside className="sidecol" aria-label="Ticket details">
      <h2 className="sr">Details</h2>
      <div className="siderow">
        <span className="lbl">Description</span>
        <p className="v">{ticket.description || 'No description.'}</p>
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

      <div className={`siderow${estInvalid ? ' bad' : ''}`}>
        <label className="lbl" htmlFor="estimatedResolutionAt">Estimated resolution</label>
        <input
          id="estimatedResolutionAt"
          type="date"
          value={draft.estimatedResolutionAt}
          onChange={set('estimatedResolutionAt')}
          aria-invalid={estInvalid}
          aria-describedby={estInvalid ? 'estimatedResolutionAt-hint' : undefined}
        />
        {estInvalid ? (
          <p id="estimatedResolutionAt-hint" className="field-hint invalid">
            {fieldErrors.estimatedResolutionAt}
          </p>
        ) : null}
      </div>

      <div className={`siderow${releaseInvalid ? ' bad' : ''}`}>
        <label className="lbl" htmlFor="expectedReleaseDate">Expected release</label>
        <input
          id="expectedReleaseDate"
          type="date"
          value={draft.expectedReleaseDate}
          onChange={set('expectedReleaseDate')}
          aria-invalid={releaseInvalid}
          aria-describedby={releaseInvalid ? 'expectedReleaseDate-hint' : undefined}
        />
        {releaseInvalid ? (
          <p id="expectedReleaseDate-hint" className="field-hint invalid">
            {fieldErrors.expectedReleaseDate}
          </p>
        ) : null}
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
        <PersonLine name={ticket.createdBy?.name} empty="—" />
      </div>
      <div className="siderow">
        <span className="lbl">Assignee</span>
        <PersonLine name={ticket.assignedTo?.name} />
      </div>
      <div className="siderow">
        <span className="lbl">Team</span>
        {ticket.team?.name
          ? <span className="v">{ticket.team.name}</span>
          : <span className="v empty">No team</span>}
      </div>

      <div className="siderow">
        <span className="lbl">
          Files{attachments.length ? ` (${attachments.length})` : ''}
        </span>
        {attachments.length > 0 ? (
          <div className="filelist">
            {attachments.map((attachment) => (
              <a
                key={attachment._id || attachment.id}
                className="fileitem"
                href={`${API_URL}${attachmentDownloadUrl(ticket.ticketId, attachment._id || attachment.id)}`}
              >
                <Icon name="clip" size={12} />
                <span className="n">{attachment.name}</span>
                {attachment.size != null && (
                  <span className="sz">{formatFileSize(attachment.size)}</span>
                )}
              </a>
            ))}
          </div>
        ) : (
          <span className="v empty">Nothing attached</span>
        )}
        {onUpload && (
          <div className="withbtn" style={{ marginTop: 8 }}>
            <input ref={uploadRef} type="file" multiple className="sr-only" aria-label="Add attachments" />
            <button type="button" className="btn btn-sm" onClick={() => uploadRef.current?.click()}>
              Choose files
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={submitUpload}>
              Upload
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
