'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Icon from '../icons.jsx';
import ConfirmDialog from '../confirm-dialog.jsx';
import AttachmentUploadLoader from '../attachment-upload-loader.jsx';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentList,
  AttachmentListItem,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
  attachmentStateFromPending,
} from '../ui/attachment.jsx';
import { attachmentErrorMessage } from '@/shared/lib/api-error.js';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_HINT,
  formatFileSize,
  validateIncomingAttachments,
} from '@/shared/lib/attachment-config.js';
import { TicketAttachmentImage, TicketAttachmentLink } from './ticket-attachment.jsx';

function isImage(file) {
  const mime = file.mimeType || file.type || '';
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|ico)$/i.test(file.name || '');
}

function formatUploadedAt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function pendingStatusLabel(status, error) {
  if (status === 'uploading') return 'Uploading…';
  if (status === 'failed') return error || 'Upload failed';
  return 'Ready to upload';
}

function LocalImagePreview({ file, alt }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!file || !isImage(file)) return undefined;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url) return <Icon name="clip" size={16} aria-hidden="true" />;

  return <img src={url} alt={alt} />;
}

function UploadedAttachmentRow({
  attachment,
  ticketId,
  canDelete,
  onDelete,
  thumbFailed,
  onThumbError,
  AttachmentLink = TicketAttachmentLink,
  AttachmentImage = TicketAttachmentImage,
  attachmentProps = {},
}) {
  const attachmentId = attachment._id || attachment.id;
  const showDelete = Boolean(onDelete && canDelete);
  const image = isImage(attachment) && !thumbFailed;

  return (
    <AttachmentListItem>
      <Attachment state="done" size="default" orientation="horizontal">
        <AttachmentMedia variant={image ? 'image' : 'icon'}>
          {image ? (
            <AttachmentTrigger asChild>
              <AttachmentImage
                ticketId={ticketId}
                attachmentId={attachmentId}
                alt=""
                className="attach-thumb"
                onError={onThumbError}
                {...attachmentProps}
              />
            </AttachmentTrigger>
          ) : (
            <Icon name="clip" size={16} aria-hidden="true" />
          )}
        </AttachmentMedia>

        <AttachmentContent>
          <AttachmentTitle>
            <AttachmentTrigger asChild>
              <AttachmentLink
                ticketId={ticketId}
                attachmentId={attachmentId}
                {...attachmentProps}
              >
                <span title={attachment.name}>{attachment.name}</span>
              </AttachmentLink>
            </AttachmentTrigger>
          </AttachmentTitle>
          <AttachmentDescription>
            {attachment.size != null && (
              <span className="sz">{formatFileSize(attachment.size)}</span>
            )}
            {attachment.uploadedBy?.name && <span>{attachment.uploadedBy.name}</span>}
            {attachment.uploadedAt && (
              <span>{formatUploadedAt(attachment.uploadedAt)}</span>
            )}
          </AttachmentDescription>
        </AttachmentContent>

        <AttachmentActions>
          <AttachmentAction
            asChild
            aria-label={`Download ${attachment.name}`}
          >
            <AttachmentLink
              ticketId={ticketId}
              attachmentId={attachmentId}
              {...attachmentProps}
            >
              <Icon name="download" size={16} aria-hidden="true" />
            </AttachmentLink>
          </AttachmentAction>
          {showDelete && (
            <AttachmentAction
              variant="destructive"
              aria-label={`Delete ${attachment.name}`}
              onClick={() => onDelete({ id: attachmentId, name: attachment.name })}
            >
              <Icon name="trash" size={16} aria-hidden="true" />
            </AttachmentAction>
          )}
        </AttachmentActions>
      </Attachment>
    </AttachmentListItem>
  );
}

function PendingAttachmentRow({
  item,
  uploading,
  onRetry,
  onRemove,
}) {
  const state = attachmentStateFromPending(item.status);
  const localImage = isImage(item.file);

  return (
    <AttachmentListItem>
      <Attachment state={state} size="sm" orientation="horizontal">
        <AttachmentMedia variant={localImage ? 'image' : 'icon'}>
          {localImage ? (
            <LocalImagePreview file={item.file} alt="" />
          ) : (
            <Icon name="clip" size={14} aria-hidden="true" />
          )}
        </AttachmentMedia>

        <AttachmentContent>
          <AttachmentTitle title={item.file.name}>{item.file.name}</AttachmentTitle>
          <AttachmentDescription>
            <span className="sz">{formatFileSize(item.file.size)}</span>
            <span>{pendingStatusLabel(item.status, item.error)}</span>
          </AttachmentDescription>
          {item.status === 'uploading' && (
            <div className="attachment-progress" aria-hidden="true">
              <div className="attachment-progress__bar" />
            </div>
          )}
        </AttachmentContent>

        <AttachmentActions>
          {item.status === 'failed' && (
            <AttachmentAction
              aria-label={`Retry ${item.file.name}`}
              disabled={uploading}
              onClick={() => onRetry(item.id)}
            >
              Retry
            </AttachmentAction>
          )}
          <AttachmentAction
            variant="destructive"
            aria-label={`Remove ${item.file.name}`}
            disabled={uploading && item.status === 'uploading'}
            onClick={() => onRemove(item.id)}
          >
            <Icon name="x" size={14} aria-hidden="true" />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
    </AttachmentListItem>
  );
}

export default function TicketAttachmentsTab({
  ticket,
  user,
  canUpload = false,
  canDelete = false,
  onUpload,
  onDelete,
  AttachmentLink = TicketAttachmentLink,
  AttachmentImage = TicketAttachmentImage,
  attachmentProps = {},
}) {
  const inputRef = useRef(null);
  const hintId = useId();
  const statusId = useId();
  const [pendingFiles, setPendingFiles] = useState([]);
  const [dragState, setDragState] = useState('normal');
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [thumbFailed, setThumbFailed] = useState({});

  const attachments = ticket.attachments ?? [];
  const readyCount = pendingFiles.filter((item) => item.status === 'ready').length;
  const showUpload = Boolean(canUpload && onUpload);

  function addIncoming(incoming) {
    if (!incoming.length || uploading) return;

    const validated = validateIncomingAttachments(pendingFiles, attachments, incoming);
    const next = validated.map((item) => ({
      id: crypto.randomUUID(),
      file: item.file,
      status: item.error ? 'failed' : 'ready',
      error: item.error || null,
    }));

    setPendingFiles((prev) => [...prev, ...next]);
  }

  function removePending(id) {
    setPendingFiles((prev) => prev.filter((item) => item.id !== id));
  }

  function retryPending(id) {
    setPendingFiles((prev) => prev.map((item) => (
      item.id === id ? { ...item, status: 'ready', error: null } : item
    )));
  }

  async function submitUpload() {
    const queue = pendingFiles.filter((item) => item.status === 'ready');
    if (!queue.length || !onUpload || uploading) return;

    setUploading(true);

    for (const item of queue) {
      setPendingFiles((prev) => prev.map((entry) => (
        entry.id === item.id ? { ...entry, status: 'uploading', error: null } : entry
      )));

      try {
        await onUpload(buildUploadForm(item.file));
        setPendingFiles((prev) => prev.filter((entry) => entry.id !== item.id));
      } catch (err) {
        const message = attachmentErrorMessage(err);
        setPendingFiles((prev) => prev.map((entry) => (
          entry.id === item.id ? { ...entry, status: 'failed', error: message } : entry
        )));
      }
    }

    setUploading(false);
  }

  async function confirmDelete() {
    if (!deleteTarget || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // Parent may surface errors; keep dialog open for retry.
    } finally {
      setDeleting(false);
    }
  }

  function handleDragEnter(event) {
    if (!canUpload || uploading) return;
    event.preventDefault();
    setDragState('dragging');
  }

  function handleDragOver(event) {
    if (!canUpload || uploading) return;
    event.preventDefault();
    if (dragState !== 'invalid') setDragState('dragging');
  }

  function handleDragLeave(event) {
    if (!canUpload || uploading) return;
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDragState('normal');
  }

  function handleDrop(event) {
    if (!canUpload || uploading) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);
    if (!files.length) {
      setDragState('invalid');
      window.setTimeout(() => setDragState('normal'), 1200);
      return;
    }
    setDragState('normal');
    addIncoming(files);
  }

  const dropClass = [
    'file-drop',
    'attach-dropzone',
    dragState === 'dragging' ? 'over' : '',
    dragState === 'invalid' ? 'invalid' : '',
    !canUpload || uploading ? 'disabled' : '',
  ].filter(Boolean).join(' ');

  const uploadLabel = readyCount === 1
    ? 'Upload 1 file'
    : `Upload ${readyCount} files`;

  function buildUploadForm(file) {
    const form = new FormData();
    form.append('files', file);
    form.append('clientRef', crypto.randomUUID());
    return form;
  }

  return (
    <section className="attach-tab" aria-label="Attachments">
      <div className="attach-section">
        <h3 className="attach-section-title">
          Attachments ({attachments.length})
        </h3>

        <AttachmentList aria-label="Uploaded attachments">
          {attachments.map((attachment) => {
            const attachmentId = attachment._id || attachment.id;

            return (
              <UploadedAttachmentRow
                key={attachmentId}
                attachment={attachment}
                ticketId={ticket.ticketId}
                canDelete={canDelete}
                onDelete={canDelete && onDelete ? (target) => setDeleteTarget(target) : null}
                thumbFailed={thumbFailed[attachmentId]}
                onThumbError={() => setThumbFailed((prev) => ({ ...prev, [attachmentId]: true }))}
                AttachmentLink={AttachmentLink}
                AttachmentImage={AttachmentImage}
                attachmentProps={attachmentProps}
              />
            );
          })}
        </AttachmentList>
      </div>

      {showUpload && (
        <div className="attach-section">
          <h3 className="attach-section-title">Files to upload</h3>

          <div
            className={dropClass}
            role="button"
            tabIndex={uploading ? -1 : 0}
            aria-labelledby={hintId}
            aria-describedby={statusId}
            aria-disabled={uploading}
            onClick={() => !uploading && inputRef.current?.click()}
            onKeyDown={(event) => {
              if (uploading) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Icon name="clip" size={18} aria-hidden="true" />
            <p className="file-drop-title" id={hintId}>
              {attachments.length === 0
                ? <>No files yet. Drag them here or <span className="browse">browse</span></>
                : <>Drag files here or <span className="browse">browse</span></>}
            </p>
            <p className="file-drop-hint">{ATTACHMENT_HINT}</p>
            {dragState === 'invalid' && (
              <p className="attach-dropzone-invalid" role="alert">
                No valid files to add
              </p>
            )}
            <input
              ref={inputRef}
              type="file"
              multiple
              className="sr-only"
              accept={ATTACHMENT_ACCEPT}
              aria-label="Choose files to upload"
              tabIndex={-1}
              disabled={uploading}
              onChange={(event) => {
                addIncoming(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </div>

          {pendingFiles.length > 0 && (
            <AttachmentList aria-label="Files to upload">
              {pendingFiles.map((item) => (
                <PendingAttachmentRow
                  key={item.id}
                  item={item}
                  uploading={uploading}
                  onRetry={retryPending}
                  onRemove={removePending}
                />
              ))}
            </AttachmentList>
          )}

          <div className="attach-upload-foot">
            {uploading && (
              <div className="attach-upload-inline">
                <AttachmentUploadLoader variant="compact" label="Uploading files…" />
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={uploading || readyCount === 0}
              aria-busy={uploading || undefined}
              onClick={submitUpload}
            >
              {uploading ? 'Uploading…' : uploadLabel}
            </button>
          </div>

          <p
            id={statusId}
            className="sr-only"
            aria-live="polite"
            aria-atomic="true"
          >
            {uploading
              ? 'Upload in progress'
              : readyCount > 0
                ? `${readyCount} file${readyCount === 1 ? '' : 's'} ready to upload`
                : ''}
          </p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete attachment?"
        message={deleteTarget ? `Remove “${deleteTarget.name}”? This cannot be undone.` : ''}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </section>
  );
}
