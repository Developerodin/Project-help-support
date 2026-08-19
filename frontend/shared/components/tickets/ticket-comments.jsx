'use client';

import { useRef, useState } from 'react';
import Icon, { initials } from '../icons.jsx';
import AttachmentUploadLoader from '../attachment-upload-loader.jsx';
import { attachmentErrorMessage } from '@/shared/lib/api-error.js';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_HINT,
  formatFileSize,
  validateAttachmentBatch,
  buildAttachmentFormData,
} from '@/shared/lib/attachment-config.js';
import {
  TicketAttachmentImage,
  TicketAttachmentLink,
} from './ticket-attachment.jsx';

function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isImageAttachment(file) {
  const mime = file.mimeType || file.type || '';
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|ico)$/i.test(file.name || '');
}

function CommentAttachment({ ticketId, file }) {
  const attachmentId = file._id || file.id;

  if (isImageAttachment(file) && attachmentId) {
    return (
      <TicketAttachmentImage
        ticketId={ticketId}
        attachmentId={attachmentId}
        alt={file.name}
        className="attach attach-img"
      >
        <span className="nm">{file.name}</span>
        {file.size != null && <span className="sz">{formatFileSize(file.size)}</span>}
      </TicketAttachmentImage>
    );
  }

  return (
    <span className="attach">
      <Icon name="clip" size={12} />
      {attachmentId ? (
        <TicketAttachmentLink ticketId={ticketId} attachmentId={attachmentId}>
          {file.name}
        </TicketAttachmentLink>
      ) : file.name}
      {file.size != null && <span className="sz">{formatFileSize(file.size)}</span>}
    </span>
  );
}

function attachOnlyContent(files) {
  if (files.length === 1) return files[0].name;
  return `Attached ${files.length} files`;
}

export default function TicketComments({ ticket, onAdd, onUpload }) {
  const [content, setContent] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [attachError, setAttachError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  function addFiles(incoming) {
    const { errors, valid } = validateAttachmentBatch(pendingFiles, incoming);
    setAttachError(errors[0] || null);
    if (valid.length) setPendingFiles((prev) => [...prev, ...valid]);
  }

  async function submit() {
    if ((!content.trim() && !pendingFiles.length) || uploading) return;
    setUploading(true);
    setAttachError(null);
    try {
      if (pendingFiles.length && onUpload) {
        await onUpload(buildAttachmentFormData(pendingFiles, {
          commentContent: content.trim() || attachOnlyContent(pendingFiles),
        }));
        setPendingFiles([]);
        setContent('');
      } else if (content.trim()) {
        await onAdd({ content: content.trim(), clientRef: crypto.randomUUID() });
        setContent('');
      }
    } catch (err) {
      setAttachError(attachmentErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  function handleCommentKeyDown(event) {
    if (event.nativeEvent?.isComposing) return;
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submit();
  }

  const canSubmit = Boolean(content.trim() || pendingFiles.length);

  return (
    <section className="discussion-tab" aria-label="Discussion">
      <div className="discussion-scroll">
        {(ticket.comments?.length ?? 0) === 0 && (
          <p className="meta">No comments yet. Say what changed or what you need.</p>
        )}

        {ticket.comments?.map((comment) => (
          <article key={comment._id || comment.id} className="comment">
            <span className="avatar sm" title={comment.commentedBy?.name || 'Someone'}>
              {initials(comment.commentedBy?.name)}
            </span>
            <div className="body">
              <div className="who">
                <b>{comment.commentedBy?.name || 'Someone'}</b>
                <span className="when">
                  {formatWhen(comment.createdAt)}
                  {comment.editedAt && ' (edited)'}
                </span>
              </div>
              <p>{comment.content}</p>
              {comment.attachments?.map((file) => (
                <CommentAttachment
                  key={file._id || file.id || file.name}
                  ticketId={ticket.ticketId}
                  file={file}
                />
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="composer">
        {attachError && (
          <p className="composer-error field-hint invalid" role="alert">{attachError}</p>
        )}

        {pendingFiles.length > 0 && (
          <ul className="composer-attachments" aria-label="Files to attach">
            {pendingFiles.map((file, index) => (
              <li key={`${file.name}-${file.size}-${index}`} className="composer-attachment-chip">
                <Icon name="clip" size={12} aria-hidden="true" />
                <span className="nm" title={file.name}>{file.name}</span>
                <span className="sz">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  className="composer-icon-btn"
                  aria-label={`Remove ${file.name}`}
                  disabled={uploading}
                  onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Icon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {uploading && (
          <div className="composer-uploading" aria-live="polite">
            <AttachmentUploadLoader variant="compact" />
          </div>
        )}

        <div className="composer-row">
          <button
            type="button"
            className="composer-icon-btn"
            aria-label={`Attach files. ${ATTACHMENT_HINT}`}
            title={`Attach files. ${ATTACHMENT_HINT}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Icon name="clip" size={15} />
          </button>

          <input
            id="new-comment"
            type="text"
            aria-label="Add a comment"
            placeholder="Add a comment..."
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={handleCommentKeyDown}
            disabled={uploading}
          />

          <button
            type="button"
            className="composer-icon-btn composer-send"
            aria-label="Send comment"
            title="Send comment"
            disabled={!canSubmit || uploading}
            onClick={submit}
            aria-busy={uploading || undefined}
          >
            <Icon name="send" size={15} />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            accept={ATTACHMENT_ACCEPT}
            aria-label="Add comment attachments"
            tabIndex={-1}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
        </div>
      </div>
    </section>
  );
}
