'use client';

import { useRef, useState } from 'react';
import Icon, { initials, isOverdue } from '../icons.jsx';
import AttachmentUploadLoader from '../attachment-upload-loader.jsx';
import { formatFileSize, ATTACHMENT_ACCEPT, validateAttachmentBatch } from '@/shared/lib/attachment-config.js';
import { TicketAttachmentLink } from './ticket-attachment.jsx';
import {
  dateValue, daysBetween, formatWhen, stageAgeDays,
} from './ticket-drawer-utils.js';

function PersonLine({ name, empty = 'Unassigned' }) {
  if (!name) return <span className="v empty">{empty}</span>;
  return (
    <span className="personline">
      <span className="avatar sm" title={name}>{initials(name)}</span>
      {name}
    </span>
  );
}

function WatcherAvatar({ name }) {
  return <span className="avatar sm" title={name}>{initials(name)}</span>;
}

export default function TicketMetadataRail({
  ticket, onSave, onBlock, onUnblock, blockReason, setBlockReason, onUpload,
  fieldErrors = {}, onFieldEdit, collapsed = false, onToggleCollapsed,
}) {
  const uploadRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [draft, setDraft] = useState({
    estimatedResolutionAt: dateValue(ticket.estimatedResolutionAt),
    expectedReleaseDate: dateValue(ticket.expectedReleaseDate),
  });

  const set = (key) => (event) => {
    onFieldEdit?.(key);
    setDraft({ ...draft, [key]: event.target.value });
  };

  const saveDates = () => {
    onSave({
      revision: ticket.revision,
      estimatedResolutionAt: draft.estimatedResolutionAt || null,
      expectedReleaseDate: draft.expectedReleaseDate || null,
    });
  };

  const estInvalid = Boolean(fieldErrors.estimatedResolutionAt);
  const releaseInvalid = Boolean(fieldErrors.expectedReleaseDate);
  const attachments = ticket.attachments ?? [];
  const late = isOverdue(ticket);
  const hasEst = Boolean(ticket.estimatedResolutionAt || draft.estimatedResolutionAt);
  const estIso = draft.estimatedResolutionAt || dateValue(ticket.estimatedResolutionAt);
  const elapsed = ticket.createdAt ? daysBetween(ticket.createdAt) : 0;
  const span = estIso ? daysBetween(ticket.createdAt, `${estIso}T00:00:00Z`) : 0;
  const pct = span > 0 ? Math.min(100, Math.round((elapsed / span) * 100)) : 0;
  const daysLeft = estIso ? -daysBetween(`${estIso}T00:00:00Z`) : null;
  const watcherExtra = Math.max(0, (ticket.watchers?.length ?? 0) - 2);

  async function submitUpload() {
    const files = uploadRef.current?.files;
    if (!files?.length || !onUpload || uploading) return;
    const { errors, valid } = validateAttachmentBatch([], Array.from(files));
    if (errors.length) {
      setUploadError(errors[0]);
      return;
    }
    const form = new FormData();
    for (const file of valid) form.append('files', file);
    form.append('clientRef', crypto.randomUUID());
    setUploading(true);
    setUploadError(null);
    try {
      await onUpload(form);
      uploadRef.current.value = '';
    } catch (err) {
      setUploadError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <aside
      className={`metadata-rail sidecol${collapsed ? ' collapsed' : ''}`}
      aria-label="Ticket metadata"
    >
      <div className="metadata-rail-head">
        <h2 className="sr">Metadata</h2>
        {onToggleCollapsed && (
          <button
            type="button"
            className="btn btn-sm metadata-rail-toggle"
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            <Icon name="layer" size={12} />
            {collapsed ? 'View details' : 'Hide details'}
          </button>
        )}
      </div>

      <div className="metadata-rail-body">
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
          <span className="lbl">Reported by</span>
          <PersonLine name={ticket.createdBy?.name} empty="—" />
          <p className="meta" style={{ marginTop: 4 }}>
            {formatWhen(ticket.createdAt)}
            {' · '}
            {elapsed}
            {' days open'}
          </p>
        </div>

        <div className={`siderow${estInvalid ? ' bad' : ''}`}>
          <label className="lbl" htmlFor="estimatedResolutionAt">Resolution estimate</label>
          {hasEst ? (
            <div className={`due${late ? ' late' : ''}`}>
              <input
                id="estimatedResolutionAt"
                type="date"
                value={draft.estimatedResolutionAt}
                onChange={set('estimatedResolutionAt')}
                onBlur={saveDates}
                aria-invalid={estInvalid}
                aria-describedby={estInvalid ? 'estimatedResolutionAt-hint' : undefined}
              />
              <div className="track">
                <span className="fill" style={{ width: `${late ? 100 : pct}%` }} />
              </div>
              <p className="read">
                {late ? (
                  <>
                    <b>{Math.abs(daysLeft ?? 0)}d late</b>
                    <span>
                      estimate was
                      {' '}
                      {formatWhen(ticket.estimatedResolutionAt || `${draft.estimatedResolutionAt}T00:00:00Z`)}
                    </span>
                  </>
                ) : (
                  <>
                    <b>{daysLeft ?? 0}d left</b>
                    <span>due {formatWhen(ticket.estimatedResolutionAt || `${draft.estimatedResolutionAt}T00:00:00Z`)}</span>
                  </>
                )}
              </p>
            </div>
          ) : (
            <>
              <input
                id="estimatedResolutionAt"
                type="date"
                value={draft.estimatedResolutionAt}
                onChange={set('estimatedResolutionAt')}
                onBlur={saveDates}
                aria-invalid={estInvalid}
                aria-describedby={estInvalid ? 'estimatedResolutionAt-hint' : undefined}
              />
              <span className="v empty">Not set</span>
              <p className="meta" style={{ marginTop: 4, color: 'var(--alarm)' }}>
                Required before In Progress.
              </p>
            </>
          )}
          {estInvalid ? (
            <p id="estimatedResolutionAt-hint" className="field-hint invalid">
              {fieldErrors.estimatedResolutionAt}
            </p>
          ) : null}
        </div>

        <div className={`siderow${releaseInvalid ? ' bad' : ''}`}>
          <label className="lbl" htmlFor="expectedReleaseDate">Expected release</label>
          {ticket.expectedReleaseDate || draft.expectedReleaseDate ? (
            <input
              id="expectedReleaseDate"
              type="date"
              value={draft.expectedReleaseDate}
              onChange={set('expectedReleaseDate')}
              onBlur={saveDates}
              aria-invalid={releaseInvalid}
              aria-describedby={releaseInvalid ? 'expectedReleaseDate-hint' : undefined}
            />
          ) : (
            <>
              <input
                id="expectedReleaseDate"
                type="date"
                value={draft.expectedReleaseDate}
                onChange={set('expectedReleaseDate')}
                onBlur={saveDates}
                aria-invalid={releaseInvalid}
                aria-describedby={releaseInvalid ? 'expectedReleaseDate-hint' : undefined}
              />
              <span className="v empty">Not set</span>
            </>
          )}
          {releaseInvalid ? (
            <p id="expectedReleaseDate-hint" className="field-hint invalid">
              {fieldErrors.expectedReleaseDate}
            </p>
          ) : null}
        </div>

        <div className="siderow">
          <span className="lbl">In current stage</span>
          <span className="v mono">{stageAgeDays(ticket)} days</span>
        </div>

        <div className="siderow">
          <span className="lbl">
            Attachments{attachments.length ? ` (${attachments.length})` : ''}
          </span>
          {attachments.length > 0 ? (
            <div className="filelist">
              {attachments.map((attachment) => (
                <TicketAttachmentLink
                  key={attachment._id || attachment.id}
                  ticketId={ticket.ticketId}
                  attachmentId={attachment._id || attachment.id}
                  className="fileitem"
                >
                  <Icon name="clip" size={12} />
                  <span className="n">{attachment.name}</span>
                  {attachment.size != null && (
                    <span className="sz">{formatFileSize(attachment.size)}</span>
                  )}
                </TicketAttachmentLink>
              ))}
            </div>
          ) : (
            <span className="v empty">Nothing attached</span>
          )}
          {onUpload && (
            <>
              {uploading ? (
                <div className="attach-upload-inline">
                  <AttachmentUploadLoader variant="compact" />
                </div>
              ) : null}
              <div className="withbtn" style={{ marginTop: 8 }}>
                <input ref={uploadRef} type="file" multiple className="sr-only" accept={ATTACHMENT_ACCEPT} aria-label="Add attachments" disabled={uploading} />
                <button type="button" className="btn btn-sm" onClick={() => uploadRef.current?.click()} disabled={uploading}>
                  Choose files
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={submitUpload} disabled={uploading}>
                  Upload
                </button>
              </div>
              {uploadError ? (
                <p className="field-hint invalid" role="alert">{uploadError}</p>
              ) : null}
            </>
          )}
        </div>

        <div className="siderow">
          <span className="lbl">Watchers</span>
          <div className="teamgrid">
            {[ticket.createdBy?.name, ticket.assignedTo?.name]
              .filter(Boolean)
              .map((name) => (
                <WatcherAvatar key={name} name={name} />
              ))}
            {watcherExtra > 0 && <span className="meta">+{watcherExtra} more</span>}
            {!ticket.createdBy?.name && !ticket.assignedTo?.name && watcherExtra === 0 && (
              <span className="v empty">None</span>
            )}
          </div>
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
      </div>
    </aside>
  );
}
