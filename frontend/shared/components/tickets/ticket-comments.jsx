'use client';

import { useRef, useState } from 'react';
import { ADMIN_ROLES, hasAnyRole, isExternalUser } from '@pms/shared';
import Icon from '../icons.jsx';
import ConfirmDialog from '../confirm-dialog.jsx';
import AttachmentUploadLoader from '../attachment-upload-loader.jsx';
import { attachmentErrorMessage, normalizeApiError } from '@/shared/lib/api-error.js';
import {
  ATTACHMENT_ACCEPT,
  formatFileSize,
  validateAttachmentBatch,
  buildAttachmentFormData,
} from '@/shared/lib/attachment-config.js';
import { Bubble, BubbleContent, BubbleGroup } from '../ui/bubble.jsx';
import { Message } from '../ui/message.jsx';
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

function commentAuthorId(comment) {
  const by = comment?.commentedBy;
  if (!by) return null;
  if (typeof by === 'string') return by;
  return String(by._id || by.id || '');
}

function commentAuthorKey(comment) {
  const by = comment?.commentedBy;
  if (!by) return 'system';
  if (typeof by === 'string') return by;
  const id = by._id || by.id;
  if (id) return String(id);
  if (by.name) return `name:${by.name}`;
  return 'unknown';
}

function isOwnComment(comment, user) {
  if (!user) return false;
  const authorId = commentAuthorId(comment);
  const userId = String(user._id || user.id || '');
  return Boolean(authorId && userId && authorId === userId);
}

function commentRecordId(comment) {
  return comment?._id || comment?.id || null;
}

function canEditComment(comment, user) {
  if (!user || isSystemComment(comment)) return false;
  return isOwnComment(comment, user);
}

function canDeleteComment(comment, user) {
  if (!user || isSystemComment(comment)) return false;
  return isOwnComment(comment, user) || hasAnyRole(user, ...ADMIN_ROLES);
}

function isSystemComment(comment) {
  return Boolean(comment?.system || comment?.kind === 'system' || !comment?.commentedBy);
}

function bubbleVariant(comment, user) {
  if (isSystemComment(comment)) return 'muted';
  if (comment.internal) return 'muted';
  if (isOwnComment(comment, user)) return 'default';
  return 'secondary';
}

function bubbleAlign(comment, user) {
  if (isSystemComment(comment)) return 'stretch';
  if (isOwnComment(comment, user)) return 'end';
  return 'start';
}

function groupComments(comments = []) {
  const groups = [];

  for (const comment of comments) {
    const authorId = commentAuthorKey(comment);
    const last = groups[groups.length - 1];

    if (last && last.authorId === authorId) {
      last.comments.push(comment);
    } else {
      groups.push({ authorId, comments: [comment] });
    }
  }

  return groups;
}

function CommentAttachment({ ticketId, file, renderAttachment }) {
  if (renderAttachment) return renderAttachment(file);

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

function CommentBubble({
  comment,
  user,
  ticketId,
  showHeader,
  canEditComments = false,
  canDeleteComments = false,
  onEdit,
  onDeleteRequest,
  actionBusy,
  renderCommentAttachment = null,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);

  const name = comment.commentedBy?.name || 'Someone';
  const variant = bubbleVariant(comment, user);
  const align = bubbleAlign(comment, user);
  const when = formatWhen(comment.createdAt);
  const edited = comment.editedAt ? ' (edited)' : '';
  const commentId = commentRecordId(comment);
  const canEdit = Boolean(canEditComments && onEdit && canEditComment(comment, user));
  const canDelete = Boolean(canDeleteComments && onDeleteRequest && canDeleteComment(comment, user));
  const showActions = (canEdit || canDelete) && !editing;
  const busy = editBusy || actionBusy;

  function startEdit() {
    setDraft(comment.content || '');
    setEditError(null);
    setEditing(true);
  }

  function cancelEdit() {
    if (editBusy) return;
    setEditing(false);
    setEditError(null);
  }

  async function saveEdit() {
    if (!draft.trim() || editBusy || !onEdit || !commentId) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await onEdit(commentId, { content: draft.trim() });
      setEditing(false);
    } catch (err) {
      setEditError(normalizeApiError(err)?.message || 'Could not save comment');
    } finally {
      setEditBusy(false);
    }
  }

  function handleEditKeyDown(event) {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (window.matchMedia?.('(hover: none)').matches) return;
    event.preventDefault();
    saveEdit();
  }

  return (
    <Message
      align={align}
      showHeader={showHeader}
      name={name}
      time={`${when}${edited}`}
      timeIso={comment.createdAt}
      meta={comment.internal ? <span className="chip comment-internal">Internal</span> : null}
    >
      <div className="bubble-row">
        <Bubble variant={variant} align={align}>
          <BubbleContent>
            {comment.internal && !editing && (
              <span className="bubble-internal-cue" title="Internal note">
                <Icon name="lock" size={12} aria-hidden="true" />
                <span className="sr-only">Internal note</span>
              </span>
            )}
            {editing ? (
              <div className="bubble-edit">
                <textarea
                  rows={3}
                  className="bubble-edit-field"
                  aria-label="Edit comment"
                  value={draft}
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleEditKeyDown}
                />
                {editError && (
                  <p className="bubble-edit-error" role="alert">{editError}</p>
                )}
                <div className="bubble-edit-foot">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={cancelEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy || !draft.trim()}
                    aria-busy={editBusy || undefined}
                    onClick={saveEdit}
                  >
                    {editBusy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {comment.content && <p className="bubble-text">{comment.content}</p>}
                {comment.attachments?.map((file) => (
                  <CommentAttachment
                    key={file._id || file.id || file.name}
                    ticketId={ticketId}
                    file={file}
                    renderAttachment={renderCommentAttachment}
                  />
                ))}
              </>
            )}
          </BubbleContent>
        </Bubble>
        {showActions && (
          <div className="bubble-actions" role="group" aria-label="Comment actions">
            {canEdit && (
              <button
                type="button"
                className="bubble-action-btn"
                aria-label="Edit comment"
                title="Edit comment"
                disabled={busy}
                onClick={startEdit}
              >
                <Icon name="pencil" size={14} />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="bubble-action-btn bubble-action-btn--danger"
                aria-label="Delete comment"
                title="Delete comment"
                disabled={busy}
                onClick={() => onDeleteRequest({ id: commentId, preview: comment.content })}
              >
                <Icon name="trash" size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </Message>
  );
}

function CommentBubbleGroup({
  group,
  user,
  ticketId,
  canEditComments,
  canDeleteComments,
  onEdit,
  onDeleteRequest,
  actionBusy,
  renderCommentAttachment = null,
}) {
  const align = bubbleAlign(group.comments[0], user);

  return (
    <BubbleGroup align={align}>
      {group.comments.map((comment, index) => (
        <CommentBubble
          key={comment._id || comment.id || `${group.authorId}-${index}`}
          comment={comment}
          user={user}
          ticketId={ticketId}
          showHeader={index === 0}
          canEditComments={canEditComments}
          canDeleteComments={canDeleteComments}
          onEdit={onEdit}
          onDeleteRequest={onDeleteRequest}
          actionBusy={actionBusy}
          renderCommentAttachment={renderCommentAttachment}
        />
      ))}
    </BubbleGroup>
  );
}

function attachOnlyContent(files) {
  if (files.length === 1) return files[0].name;
  return `Attached ${files.length} files`;
}

export default function TicketComments({
  ticket,
  user,
  canComment = false,
  canEditComments = false,
  canDeleteComments = false,
  onAdd,
  onUpload,
  onEdit,
  onDelete,
  renderCommentAttachment = null,
}) {
  const [content, setContent] = useState('');
  const [internalOnly, setInternalOnly] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [attachError, setAttachError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);
  const canCreateInternalComment = Boolean(user) && !isExternalUser(user);
  const commentGroups = groupComments(ticket.comments);
  const actionBusy = uploading || deleting;

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
        await onAdd({ content: content.trim(), internal: internalOnly, clientRef: crypto.randomUUID() });
        setContent('');
        setInternalOnly(false);
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
    // On a touch keyboard Enter is the only way to get a new line, so leave it
    // alone there and let the send button post.
    if (window.matchMedia?.('(hover: none)').matches) return;
    event.preventDefault();
    submit();
  }

  const canSubmit = Boolean(content.trim() || pendingFiles.length);

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

  return (
    <section className="discussion-tab" aria-label="Discussion">
      {(ticket.comments?.length ?? 0) === 0 && (
        <p className="meta">No comments yet. Say what changed or what you need.</p>
      )}

      {commentGroups.length > 0 && (
        <div className="message-list" role="log" aria-label="Comments" aria-live="polite">
          {commentGroups.map((group) => (
            <CommentBubbleGroup
              key={group.comments.map((c) => c._id || c.id).join('-') || group.authorId}
              group={group}
              user={user}
              ticketId={ticket.ticketId}
              canEditComments={canEditComments}
              canDeleteComments={canDeleteComments}
              onEdit={onEdit}
              onDeleteRequest={onDelete ? (target) => setDeleteTarget(target) : null}
              actionBusy={actionBusy}
              renderCommentAttachment={renderCommentAttachment}
            />
          ))}
        </div>
      )}

      <div className="composer">
        {canComment && (
          <>
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

        <div className={`composer-row${internalOnly ? ' composer-row--internal' : ''}`}>
          <textarea
            id="new-comment"
            rows={1}
            className="composer-textarea"
            aria-label={internalOnly ? 'Add an internal note' : 'Add a comment'}
            placeholder={internalOnly ? 'Add an internal note...' : 'Add a comment...'}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={handleCommentKeyDown}
            disabled={uploading}
          />

          {canCreateInternalComment && (
            <button
              type="button"
              className={`composer-icon-btn composer-internal-toggle${internalOnly ? ' is-active' : ''}`}
              aria-pressed={internalOnly}
              aria-label={internalOnly ? 'Internal note enabled' : 'Make internal note'}
              title="Only visible to internal team members"
              disabled={uploading}
              onClick={() => setInternalOnly((prev) => !prev)}
            >
              <Icon name="lock" size={15} />
            </button>
          )}

          <button
            type="button"
            className="composer-icon-btn"
            aria-label="Attach files"
            title="Attach files"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Icon name="clip" size={15} />
          </button>

          <button
            type="button"
            className="composer-icon-btn composer-send"
            aria-label={uploading ? 'Posting comment' : internalOnly ? 'Comment internally' : 'Send comment'}
            title={uploading ? 'Posting comment' : internalOnly ? 'Comment internally (Enter)' : 'Send comment (Enter)'}
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
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete comment?"
        message={deleteTarget
          ? `Remove this comment${deleteTarget.preview ? `: “${deleteTarget.preview.slice(0, 120)}${deleteTarget.preview.length > 120 ? '…' : ''}”` : ''}? This cannot be undone.`
          : ''}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </section>
  );
}

export {
  bubbleAlign,
  bubbleVariant,
  canDeleteComment,
  canEditComment,
  commentAuthorId,
  commentAuthorKey,
  groupComments,
  isOwnComment,
};
