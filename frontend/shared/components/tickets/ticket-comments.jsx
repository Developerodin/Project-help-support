'use client';

import { useRef, useState } from 'react';
import Icon, { initials } from '../icons.jsx';
import AttachmentUploadLoader from '../attachment-upload-loader.jsx';
import { attachmentErrorMessage } from '@/shared/lib/api-error.js';
import {
  ATTACHMENT_ACCEPT,
  formatFileSize,
  validateAttachmentBatch,
  buildAttachmentFormData,
} from '@/shared/lib/attachment-config.js';

const COMPOSER_HINT = 'PNG, JPG, PDF, TXT or LOG Â· 10 MB';

function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TicketComments({ ticket, onAdd, onUpload }) {
  const [content, setContent] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [attachError, setAttachError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

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
        await onUpload(buildAttachmentFormData(pendingFiles));
        setPendingFiles([]);
      }
      if (content.trim()) {
        await onAdd({ content: content.trim(), clientRef: crypto.randomUUID() });
        setContent('');
      }
    } catch (err) {
      setAttachError(attachmentErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  const canSubmit = Boolean(content.trim() || pendingFiles.length);

  return (
    <section aria-label="Discussion">
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
              <span key={file._id || file.id || file.name} className="attach">
                <Icon name="clip" size={12} />
                {file.name}
                {file.size != null && <span className="sz">{formatFileSize(file.size)}</span>}
              </span>
            ))}
          </div>
        </article>
      ))}

      <div className="composer">
        <textarea
          id="new-comment"
          rows={3}
          placeholder="Add a comment. Type @ to notify someone."
          aria-label="Add a comment"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        {pendingFiles.length > 0 && (
          <ul className="file-list composer-files" aria-label="Files to attach">
            {pendingFiles.map((file, index) => (
              <li key={`${file.name}-${file.size}-${index}`}>
                <Icon name="clip" size={12} />
                <span className="nm" title={file.name}>{file.name}</span>
                <span className="sz">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
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
        <div className="composer-foot">
          {uploading ? (
            <div className="attach-upload-inline attach-upload-inline--composer">
              <AttachmentUploadLoader variant="compact" />
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Icon name="clip" size={13} />
            Attach
          </button>
          <span className="meta">{COMPOSER_HINT}</span>
          {pendingFiles.length > 0 && (
            <span className="meta">Files appear in Details â†’ Files after posting</span>
          )}
          {attachError && <span className="field-hint invalid" role="alert">{attachError}</span>}
          <input
            ref={inputRef}
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
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={uploading || !canSubmit}
          >
            {pendingFiles.length && !content.trim() ? 'Attach files' : 'Comment'}
          </button>
        </div>
      </div>
    </section>
  );
}

