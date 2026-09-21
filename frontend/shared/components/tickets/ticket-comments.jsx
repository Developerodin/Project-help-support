'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ADMIN_ROLES, hasAnyRole, isExternalUser } from '@pms/shared';
import Icon from '../icons.jsx';
import CommentMentionPicker from './comment-mention-picker.jsx';
import { useActiveUserSearch } from '@/shared/hooks/use-active-user-search.js';
import {
  collectMentionIds,
  filterMentionCandidates,
  insertMentionAt,
  mentionTriggerAt,
  segmentCommentMentions,
} from '@/shared/lib/mention-text.js';
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

function normalizePersonId(value) {
  if (value == null || value === '' || value === 'undefined') return null;
  return String(value);
}

function commentAuthorId(comment) {
  const by = comment?.commentedBy;
  if (!by) return null;
  if (typeof by === 'string') return normalizePersonId(by);
  // Sanitized API uses `id`; populated docs may still carry `_id`.
  return normalizePersonId(by.id ?? by._id);
}

function commentAuthorKey(comment) {
  const authorId = commentAuthorId(comment);
  if (authorId) return authorId;
  const by = comment?.commentedBy;
  if (!by) return 'system';
  if (by.name) return `name:${by.name}`;
  return 'unknown';
}

function isOwnComment(comment, user) {
  if (!user) return false;
  const authorId = commentAuthorId(comment);
  const userId = normalizePersonId(user.id ?? user._id);
  return Boolean(authorId && userId && authorId === userId);
}

function isUnreadDiscussionComment(comment, user, discussionLastReadAt) {
  if (!discussionLastReadAt || isSystemComment(comment)) return false;
  if (isOwnComment(comment, user)) return false;
  if (user && isExternalUser(user) && comment.internal) return false;
  const readAt = new Date(discussionLastReadAt).getTime();
  if (Number.isNaN(readAt)) return false;
  return new Date(comment.createdAt).getTime() > readAt;
}

function commentRecordId(comment) {
  return comment?._id || comment?.id || null;
}

function commentDomId(comment) {
  const id = commentRecordId(comment);
  return id ? `comment-${id}` : null;
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

function isExternalCommentAuthor(comment) {
  const by = comment?.commentedBy;
  if (!by) return false;
  if (typeof by.external === 'boolean') return by.external;
  if (by.role || by.roles?.length) return isExternalUser(by);
  return false;
}

function bubbleAlign(comment, user) {
  if (isSystemComment(comment)) return 'stretch';
  if (comment.internal) return 'start';
  if (isExternalCommentAuthor(comment)) return 'end';
  // Sanitized external API strips roles; own-comment fallback for external viewers.
  if (user && isExternalUser(user) && isOwnComment(comment, user)) return 'end';
  return 'start';
}

function bubbleVariant(comment, user) {
  if (isSystemComment(comment)) return 'muted';
  if (comment.internal) return 'muted';
  return bubbleAlign(comment, user) === 'end' ? 'default' : 'secondary';
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

function CommentContent({ content, mentions }) {
  const segments = segmentCommentMentions(content, mentions);
  return (
    <p className="bubble-text">
      {segments.map((segment, index) => {
        if (segment.type === 'mention') {
          return (
            <span
              key={`m-${index}`}
              className="bubble-mention"
              title={segment.person.name}
            >
              {segment.value}
            </span>
          );
        }
        return <span key={`t-${index}`}>{segment.value}</span>;
      })}
    </p>
  );
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
  highlighted = false,
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

  const domId = commentDomId(comment);

  return (
    <Message
      align={align}
      showHeader={showHeader}
      name={name}
      id={domId}
      className={highlighted ? 'comment-highlight' : undefined}
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
                {comment.content && (
                  <CommentContent content={comment.content} mentions={comment.mentions} />
                )}
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
                <Icon name="pencil" size={16} />
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
                <Icon name="trash" size={16} />
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
  showNewBadge = false,
  highlightCommentId = null,
  firstUnread = false,
}) {
  const align = bubbleAlign(group.comments[0], user);

  return (
    <BubbleGroup align={align} data-first-unread={firstUnread ? 'true' : undefined}>
      {showNewBadge && (
        <p className="discussion-new-marker" aria-hidden="true">
          <span className="chip chip-new-reply">NEW</span>
        </p>
      )}
      {group.comments.map((comment, index) => {
        const commentId = commentRecordId(comment);
        return (
        <CommentBubble
          key={comment._id || comment.id || `${group.authorId}-${index}`}
          comment={comment}
          user={user}
          ticketId={ticketId}
          showHeader
          canEditComments={canEditComments}
          canDeleteComments={canDeleteComments}
          onEdit={onEdit}
          onDeleteRequest={onDeleteRequest}
          actionBusy={actionBusy}
          renderCommentAttachment={renderCommentAttachment}
          highlighted={Boolean(highlightCommentId && commentId && String(commentId) === String(highlightCommentId))}
        />
        );
      })}
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
  discussionLastReadAt = null,
  canComment = false,
  canEditComments = false,
  canDeleteComments = false,
  onAdd,
  onUpload,
  onEdit,
  onDelete,
  renderCommentAttachment = null,
  scrollToFirstUnread = false,
  highlightCommentId = null,
  mentionCandidates = [],
}) {
  const [content, setContent] = useState('');
  const [mentionMap, setMentionMap] = useState(() => new Map());
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionRange, setMentionRange] = useState(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [internalOnly, setInternalOnly] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [attachError, setAttachError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);
  const messageListRef = useRef(null);
  const didScrollUnreadRef = useRef(false);
  const canCreateInternalComment = Boolean(user) && !isExternalUser(user);
  const commentGroups = groupComments(ticket.comments);
  const actionBusy = uploading || deleting;
  const composerRef = useRef(null);
  const serverMentionSearch = mentionCandidates.length === 0;

  // Opening the tab marks the discussion read, so the ticket's own
  // discussionLastReadAt jumps to "now" a moment later. Latch the value this
  // ticket was opened with, or the NEW markers vanish before they are read.
  const readAtLatch = useRef({ ticketId: null, value: null });
  if (readAtLatch.current.ticketId !== ticket.ticketId) {
    readAtLatch.current = { ticketId: ticket.ticketId, value: discussionLastReadAt ?? null };
  }
  const markerReadAt = readAtLatch.current.value;
  const {
    query: mentionServerQuery,
    setQuery: setMentionServerQuery,
    available: serverMentionResults,
    loading: mentionSearchLoading,
    error: mentionSearchError,
    retry: retryMentionSearch,
  } = useActiveUserSearch({
    enabled: mentionOpen && serverMentionSearch && canComment,
  });

  const mentionQuery = mentionRange?.query ?? '';
  const mentionPool = useMemo(() => {
    if (!mentionOpen) return [];
    if (serverMentionSearch) return serverMentionResults;
    return filterMentionCandidates(mentionCandidates, mentionQuery);
  }, [
    mentionOpen,
    serverMentionSearch,
    serverMentionResults,
    mentionCandidates,
    mentionQuery,
  ]);

  useLayoutEffect(() => {
    didScrollUnreadRef.current = false;
  }, [ticket.ticketId]);

  useLayoutEffect(() => {
    if (!scrollToFirstUnread && !highlightCommentId) return undefined;
    const root = messageListRef.current;
    if (!root) return undefined;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const behavior = reduceMotion ? 'auto' : 'smooth';
    let target = null;
    if (highlightCommentId) {
      const safeId = typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(String(highlightCommentId))
        : String(highlightCommentId).replace(/[^\w-]/g, '');
      target = root.querySelector(`#comment-${safeId}`);
    }
    if (!target && scrollToFirstUnread && !didScrollUnreadRef.current) {
      target = root.querySelector('[data-first-unread="true"]');
    }
    if (!target) return undefined;
    target.scrollIntoView({ block: 'center', behavior });
    if (!highlightCommentId) didScrollUnreadRef.current = true;
    return undefined;
  }, [
    scrollToFirstUnread,
    highlightCommentId,
    markerReadAt,
    ticket.comments?.length,
    ticket.ticketId,
  ]);

  function addFiles(incoming) {
    const { errors, valid } = validateAttachmentBatch(pendingFiles, incoming);
    setAttachError(errors[0] || null);
    if (valid.length) setPendingFiles((prev) => [...prev, ...valid]);
  }

  function closeMentionPicker() {
    setMentionOpen(false);
    setMentionRange(null);
    setMentionActiveIndex(0);
  }

  function pickMention(person) {
    if (!mentionRange || !person) return;
    const { next, caret } = insertMentionAt(
      content,
      mentionRange.start,
      mentionRange.end,
      person.name,
    );
    setContent(next);
    setMentionMap((prev) => {
      const map = new Map(prev);
      map.set(person.name, person.id);
      return map;
    });
    closeMentionPicker();
    requestAnimationFrame(() => {
      const field = composerRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  }

  function syncMentionTrigger(nextContent, caretIndex) {
    const trigger = mentionTriggerAt(nextContent, caretIndex);
    if (!trigger) {
      closeMentionPicker();
      return;
    }
    setMentionOpen(true);
    setMentionRange(trigger);
    setMentionActiveIndex(0);
    if (serverMentionSearch) setMentionServerQuery(trigger.query);
  }

  async function submit() {
    if ((!content.trim() && !pendingFiles.length) || uploading) return;
    setUploading(true);
    setAttachError(null);
    const mentions = collectMentionIds(content.trim(), mentionMap);
    try {
      if (pendingFiles.length && onUpload) {
        await onUpload(buildAttachmentFormData(pendingFiles, {
          commentContent: content.trim() || attachOnlyContent(pendingFiles),
        }));
        setPendingFiles([]);
        setContent('');
        setMentionMap(new Map());
        closeMentionPicker();
      } else if (content.trim()) {
        await onAdd({
          content: content.trim(),
          mentions,
          internal: internalOnly,
          clientRef: crypto.randomUUID(),
        });
        setContent('');
        setMentionMap(new Map());
        setInternalOnly(false);
        closeMentionPicker();
      }
    } catch (err) {
      setAttachError(attachmentErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  function handleCommentKeyDown(event) {
    if (event.nativeEvent?.isComposing) return;
    if (mentionOpen && mentionPool.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionActiveIndex((index) => Math.min(index + 1, mentionPool.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionActiveIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pickMention(mentionPool[mentionActiveIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMentionPicker();
        return;
      }
    }
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
        <div
          className="message-list"
          role="log"
          aria-label="Comments"
          aria-live="polite"
          ref={messageListRef}
        >
          {(() => {
            let newDividerShown = false;
            let firstUnreadGroup = false;
            return commentGroups.map((group) => {
              const groupHasUnread = group.comments.some((comment) => (
                isUnreadDiscussionComment(comment, user, markerReadAt)
              ));
              const showDivider = groupHasUnread && !newDividerShown;
              if (showDivider) newDividerShown = true;
              const markFirstUnread = groupHasUnread && !firstUnreadGroup;
              if (markFirstUnread) firstUnreadGroup = true;
              return (
                <div key={group.comments.map((c) => c._id || c.id).join('-') || group.authorId}>
                  {showDivider && (
                    <div className="discussion-new-separator" role="separator" aria-label="New replies">
                      <span>New replies</span>
                    </div>
                  )}
                  <CommentBubbleGroup
                    group={group}
                    user={user}
                    ticketId={ticket.ticketId}
                    canEditComments={canEditComments}
                    canDeleteComments={canDeleteComments}
                    onEdit={onEdit}
                    onDeleteRequest={onDelete ? (target) => setDeleteTarget(target) : null}
                    actionBusy={actionBusy}
                    renderCommentAttachment={renderCommentAttachment}
                    showNewBadge={groupHasUnread}
                    highlightCommentId={highlightCommentId}
                    firstUnread={markFirstUnread}
                  />
                </div>
              );
            });
          })()}
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
          <div className="composer-mention-wrap">
            <CommentMentionPicker
              open={mentionOpen}
              candidates={mentionPool}
              activeIndex={mentionActiveIndex}
              loading={serverMentionSearch && mentionSearchLoading}
              error={serverMentionSearch ? mentionSearchError : null}
              onRetry={retryMentionSearch}
              onHover={setMentionActiveIndex}
              onPick={pickMention}
            />
            <textarea
              ref={composerRef}
              id="new-comment"
              rows={1}
              className="composer-textarea"
              aria-label={internalOnly ? 'Add an internal note' : 'Add a comment'}
              aria-autocomplete={mentionOpen ? 'list' : undefined}
              aria-controls={mentionOpen ? 'comment-mention-listbox' : undefined}
              placeholder={internalOnly ? 'Add an internal note...' : 'Add a comment... Use @ to mention someone.'}
              value={content}
              onChange={(event) => {
                const next = event.target.value;
                setContent(next);
                syncMentionTrigger(next, event.target.selectionStart ?? next.length);
              }}
              onKeyDown={handleCommentKeyDown}
              disabled={uploading}
            />
          </div>

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
  isExternalCommentAuthor,
  isOwnComment,
};
