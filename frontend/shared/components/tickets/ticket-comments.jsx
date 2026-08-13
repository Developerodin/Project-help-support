'use client';

import { useRef, useState } from 'react';
import Icon, { initials } from '../icons.jsx';
import AttachmentUploadLoader from '../attachment-upload-loader.jsx';
import {
  ATTACHMENT_ACCEPT,
  formatFileSize,
  validateAttachmentBatch,
  buildAttachmentFormData,
} from '@/shared/lib/attachment-config.js';

const COMPOSER_HINT = 'PNG, JPG, PDF, TXT or LOG · 10 MB';

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
    if (!content.trim() || uploading) return;
    setUploading(true);
    try {
      if (pendingFiles.length && onUpload) {
        await onUpload(buildAttachmentFormData(pendingFiles));
        setPendingFiles([]);
      }
      await onAdd({ content, clientRef: crypto.randomUUID() });
      setContent('');
      setAttachError(null);
    } finally {
      setUploading(false);
    }
  }

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
            <span className="meta">
              {pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} selected
            </span>
          )}
          {attachError && <span className="field-hint invalid">{attachError}</span>}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            accept={ATTACHMENT_ACCEPT}
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <span className="spacer" />
          <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={uploading}>
            Comment
          </button>
        </div>
      </div>
    </section>
  );
}
