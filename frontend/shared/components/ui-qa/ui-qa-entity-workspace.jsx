'use client';

import { can, canTransitionQaStatus } from '@pms/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import Icon from '@/shared/components/icons.jsx';
import FormError from '@/shared/components/form-error.jsx';
import TicketComments from '@/shared/components/tickets/ticket-comments.jsx';
import TicketAttachmentsTab from '@/shared/components/tickets/ticket-attachments-tab.jsx';
import TicketHistory from '@/shared/components/tickets/ticket-history.jsx';
import {
  addUiQaComment,
  deleteUiQaComment,
  editUiQaComment,
  removeUiQaAttachment,
  updateUiQaStatus,
  uploadUiQaAttachments,
} from '@/shared/api/ui-qa.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { formatFileSize } from '@/shared/lib/attachment-config.js';
import { buildUiQaActivityFeed } from './ui-qa-activity.js';
import { UiQaAttachmentImage, UiQaAttachmentLink } from './ui-qa-attachment.jsx';
import UiQaDetailsTab from './ui-qa-details-tab.jsx';
import UiQaDrawerFooter from './ui-qa-drawer-footer.jsx';
import UiQaHeader from './ui-qa-header.jsx';
import UiQaStageBar from './ui-qa-stage-bar.jsx';
import { countIndicators } from './ui-qa-utils.js';

const TAB_ORDER = ['discussion', 'details', 'attachments', 'history'];

function isImageAttachment(file) {
  const mime = file.mimeType || file.type || '';
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|ico)$/i.test(file.name || '');
}

/**
 * Ticket-detail workspace for a selected module/page/screen entity.
 */
export default function UiQaEntityWorkspace({
  projectId,
  entity,
  title,
  breadcrumbs = [],
  meta,
  data,
  counts = {},
  user,
  permissionContext = null,
  onUpdated,
  onClose,
}) {
  const [tab, setTab] = useState('discussion');
  const [error, setError] = useState(null);
  const discussionRef = useRef(null);
  const detailsRef = useRef(null);
  const attachmentsRef = useRef(null);
  const historyRef = useRef(null);

  const panelRefs = {
    discussion: discussionRef,
    details: detailsRef,
    attachments: attachmentsRef,
    history: historyRef,
  };

  const currentStatus = data?.qaStatus || 'open';
  const { attachments } = countIndicators(data);
  const canViewUiQa = can(user, 'ui_qa.view', permissionContext);
  const canEditUiQa = can(user, 'ui_qa.edit', permissionContext);
  const canDeleteUiQa = can(user, 'ui_qa.delete', permissionContext);
  const attachmentProps = useMemo(() => ({ projectId, entity }), [projectId, entity]);
  const activityFeed = useMemo(() => buildUiQaActivityFeed(data), [data]);

  const ticketShaped = useMemo(() => ({
    ticketId: 'ui-qa',
    comments: data?.comments || [],
    attachments: data?.attachments || [],
  }), [data]);

  const selectTab = useCallback((next) => {
    setTab(next);
    requestAnimationFrame(() => {
      panelRefs[next]?.current?.focus();
    });
  }, []);

  const onTabKeyDown = useCallback((event) => {
    const index = TAB_ORDER.indexOf(tab);
    let next = null;
    if (event.key === 'ArrowRight') next = TAB_ORDER[(index + 1) % TAB_ORDER.length];
    if (event.key === 'ArrowLeft') next = TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    if (event.key === 'Home') next = TAB_ORDER[0];
    if (event.key === 'End') next = TAB_ORDER[TAB_ORDER.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    requestAnimationFrame(() => {
      const el = document.getElementById(`tab-${next}`);
      el?.focus();
    });
  }, [tab, selectTab]);

  const run = useCallback((operation) => async (...args) => {
    setError(null);
    try {
      await operation(...args);
      await onUpdated?.();
    } catch (err) {
      setError(normalizeApiError(err));
      throw err;
    }
  }, [onUpdated]);

  const renderCommentAttachment = useCallback((file) => {
    const attachmentId = file._id || file.id;
    if (isImageAttachment(file) && attachmentId) {
      return (
        <UiQaAttachmentImage
          projectId={projectId}
          attachmentId={attachmentId}
          entity={entity}
          alt={file.name}
          className="attach attach-img"
        >
          <span className="nm">{file.name}</span>
          {file.size != null && <span className="sz">{formatFileSize(file.size)}</span>}
        </UiQaAttachmentImage>
      );
    }

    return (
      <span className="attach">
        <Icon name="clip" size={12} />
        {attachmentId ? (
          <UiQaAttachmentLink
            projectId={projectId}
            attachmentId={attachmentId}
            entity={entity}
          >
            {file.name}
          </UiQaAttachmentLink>
        ) : file.name}
        {file.size != null && <span className="sz">{formatFileSize(file.size)}</span>}
      </span>
    );
  }, [projectId, entity]);

  const handleTransition = run(async ({ status, note }) => {
    if (status === currentStatus || !canTransitionQaStatus(currentStatus, status)) return;
    await updateUiQaStatus(projectId, {
      entity,
      status,
      note,
    });
  });

  const handleUpload = run(async (form) => {
    form.append('entity', JSON.stringify(entity));
    if (!form.get('clientRef')) form.append('clientRef', crypto.randomUUID());
    await uploadUiQaAttachments(projectId, form);
  });

  const handleCommentUpload = run(async (form) => {
    const commentContent = form.get('commentContent');
    form.append('entity', JSON.stringify(entity));
    if (!form.get('clientRef')) form.append('clientRef', crypto.randomUUID());
    await uploadUiQaAttachments(projectId, form);
    if (commentContent && String(commentContent).trim()) {
      await addUiQaComment(projectId, {
        entity,
        content: String(commentContent).trim(),
        clientRef: form.get('commentClientRef') || crypto.randomUUID(),
      });
    }
  });

  return (
    <>
      <div className="drawer-head">
        <UiQaHeader
          title={title}
          entity={entity}
          data={data}
          breadcrumbs={breadcrumbs}
          meta={meta}
          onClose={onClose}
        />
        <FormError error={error} />
        <div className="drawer-rail">
          <h2 className="sr">QA status</h2>
          <UiQaStageBar
            status={currentStatus}
            onTransition={canEditUiQa ? handleTransition : undefined}
          />
        </div>
        <div className="tabs" role="tablist" aria-label="Entity detail" onKeyDown={onTabKeyDown}>
          <button
            type="button"
            className="tab"
            role="tab"
            id="tab-discussion"
            aria-selected={tab === 'discussion'}
            aria-controls="panel-discussion"
            tabIndex={tab === 'discussion' ? 0 : -1}
            onClick={() => selectTab('discussion')}
          >
            Discussion
            <span className="n">{data?.comments?.length || 0}</span>
          </button>
          <button
            type="button"
            className="tab"
            role="tab"
            id="tab-details"
            aria-selected={tab === 'details'}
            aria-controls="panel-details"
            tabIndex={tab === 'details' ? 0 : -1}
            onClick={() => selectTab('details')}
          >
            Details
          </button>
          <button
            type="button"
            className="tab"
            role="tab"
            id="tab-attachments"
            aria-selected={tab === 'attachments'}
            aria-controls="panel-attachments"
            tabIndex={tab === 'attachments' ? 0 : -1}
            onClick={() => selectTab('attachments')}
          >
            Attachments
            <span className="n">{attachments}</span>
          </button>
          <button
            type="button"
            className="tab"
            role="tab"
            id="tab-history"
            aria-selected={tab === 'history'}
            aria-controls="panel-history"
            tabIndex={tab === 'history' ? 0 : -1}
            onClick={() => selectTab('history')}
          >
            History
            <span className="n">{activityFeed.length}</span>
          </button>
        </div>
      </div>

      <div className="drawer-body">
        <div className="ticket-workspace ticket-workspace--full">
          <main className="ticket-main">
            <div className="drawer-main-scroll drawer-main-panels">
              <div
                id="panel-discussion"
                role="tabpanel"
                aria-labelledby="tab-discussion"
                tabIndex={-1}
                ref={discussionRef}
                hidden={tab !== 'discussion'}
              >
                <TicketComments
                  ticket={ticketShaped}
                  user={user}
                  canComment={canViewUiQa}
                  canEditComments={canEditUiQa}
                  canDeleteComments={canEditUiQa}
                  renderCommentAttachment={renderCommentAttachment}
                  onAdd={canViewUiQa
                    ? run((body) => addUiQaComment(projectId, {
                      entity,
                      ...body,
                    }))
                    : undefined}
                  onUpload={canViewUiQa ? handleCommentUpload : undefined}
                  onEdit={canEditUiQa
                    ? run((commentId, body) => editUiQaComment(projectId, commentId, {
                      entity,
                      ...body,
                    }))
                    : undefined}
                  onDelete={canEditUiQa
                    ? run((commentId) => deleteUiQaComment(projectId, commentId, { entity }))
                    : undefined}
                />
              </div>
              <div
                id="panel-details"
                role="tabpanel"
                aria-labelledby="tab-details"
                tabIndex={-1}
                ref={detailsRef}
                hidden={tab !== 'details'}
              >
                <div className="detail-tab">
                  <UiQaDetailsTab
                    entity={entity}
                    data={data}
                    breadcrumbs={breadcrumbs}
                    meta={meta}
                    counts={counts}
                  />
                </div>
              </div>
              <div
                id="panel-attachments"
                role="tabpanel"
                aria-labelledby="tab-attachments"
                tabIndex={-1}
                ref={attachmentsRef}
                hidden={tab !== 'attachments'}
              >
                <TicketAttachmentsTab
                  ticket={ticketShaped}
                  user={user}
                  canUpload={canViewUiQa}
                  canDelete={canDeleteUiQa}
                  AttachmentLink={UiQaAttachmentLink}
                  AttachmentImage={UiQaAttachmentImage}
                  attachmentProps={attachmentProps}
                  onUpload={canViewUiQa ? handleUpload : undefined}
                  onDelete={canDeleteUiQa
                    ? run((attachmentId) => removeUiQaAttachment(projectId, attachmentId, { entity }))
                    : undefined}
                />
              </div>
              <div
                id="panel-history"
                role="tabpanel"
                aria-labelledby="tab-history"
                tabIndex={-1}
                ref={historyRef}
                hidden={tab !== 'history'}
              >
                <TicketHistory
                  ticket={ticketShaped}
                  activityFeed={activityFeed}
                  onOpenDiscussion={() => selectTab('discussion')}
                />
              </div>
            </div>
          </main>
        </div>
      </div>

      <UiQaDrawerFooter
        status={currentStatus}
        onTransition={canEditUiQa ? handleTransition : undefined}
      />
    </>
  );
}
