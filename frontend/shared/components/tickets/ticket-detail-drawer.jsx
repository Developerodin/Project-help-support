'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ESTIMATE_DATE_EDITOR_ROLES, hasAnyRole, isExternalUser, can, canChangeTicketStage,
} from '@pms/shared';
import {
  getTicket, patchTicket, transitionTicket, addComment, editComment, deleteComment, uploadAttachments, deleteAttachment, assignTicket,
  watchTicket, unwatchTicket, setBlocked, clearBlocked, deleteTicket, markDiscussionRead,
} from '@/shared/api/tickets.js';
import { isAbortError } from '@/shared/api/client.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { useProject } from '@/shared/contexts/project-context.jsx';
import Icon from '@/shared/components/icons.jsx';
import FormError from '@/shared/components/form-error.jsx';
import ValidationDialog from '@/shared/components/validation-dialog.jsx';
import {
  getPatchFieldErrors,
  isPatchFieldError,
  logApiError,
  normalizeApiError,
  shouldLogApiError,
} from '@/shared/lib/api-error.js';
import { handleTransitionError } from '@/shared/lib/handle-transition-error.js';
import TicketHeader from './ticket-header.jsx';
import TicketDetailsTab from './ticket-details-tab.jsx';
import TicketAttachmentsTab from './ticket-attachments-tab.jsx';
import TicketMetadataRail from './ticket-metadata-rail.jsx';
import TicketStageBar from './ticket-stage-bar.jsx';
import TicketHistory from './ticket-history.jsx';
import TicketComments from './ticket-comments.jsx';
import TicketQaReport, { qaRejections } from './ticket-qa-report.jsx';
import TicketDrawerFooter from './ticket-drawer-footer.jsx';
import TicketNotificationControl from './ticket-notification-control.jsx';
import ConfirmDialog from '../confirm-dialog.jsx';
import { useTicketAssignment } from './use-ticket-assignment.js';
import { useBoardPolicy } from '@/shared/hooks/use-board-policy.js';
import { usePermissionContext } from '@/shared/hooks/use-permission-context.js';
import { permissionContextForUi } from '@/shared/lib/permission-context-ui.js';
import AppLoader from '../app-loader.jsx';
import { useHistorySearch } from '@/shared/lib/use-history-search.js';
import { TAB_PARAM, TICKET_PARAM, tabFromSearch } from '@/shared/lib/deep-link.js';
import { useProjectMentionCandidates } from '@/shared/hooks/use-project-mention-candidates.js';

function nestedDialogOpen(drawerNode) {
  const layers = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  return Array.from(layers).some((el) => el !== drawerNode);
}

function TicketDrawerContent({
  ticket,
  user,
  ticketId,
  onClose,
  onChanged,
  load,
  boardPolicy,
  permissionContext,
  permissionsLoadFailed,
  onRetryPermissions,
  projectBanner,
  highlightCommentId = null,
}) {
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [validationDialog, setValidationDialog] = useState(null);
  const [tab, setTab] = useState('discussion');
  // The address bar can name a tab (?tab=details), e.g. a shared link or the assistant.
  const urlTab = tabFromSearch(useHistorySearch());
  const [blockReason, setBlockReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const discussionRef = useRef(null);
  const detailsRef = useRef(null);
  const attachmentsRef = useRef(null);
  const historyRef = useRef(null);
  const qaRef = useRef(null);

  const panelRefs = {
    discussion: discussionRef,
    details: detailsRef,
    attachments: attachmentsRef,
    history: historyRef,
    qa: qaRef,
  };

  const mentionProjectId = ticket?.project?.id ?? ticket?.project?._id ?? null;
  const mentionCandidates = useProjectMentionCandidates(mentionProjectId, {
    enabled: Boolean(mentionProjectId),
  });

  // Identifies "this ticket, at this reply count". Marking read once per key
  // both stops the effect re-firing on every `ticket` identity change and still
  // re-marks when a newer reply lands while the tab is open.
  const discussionKey = ticket ? `${ticketId}:${ticket.comments?.length ?? 0}` : null;
  const [readMarkedKey, setReadMarkedKey] = useState(null);
  // Clear the badge from what we just did rather than refetching the ticket:
  // load() nulls `ticket` first, so a refetch here blanks the open drawer.
  const discussionUnread = readMarkedKey === discussionKey
    ? 0
    : Number(ticket?.discussionUnreadCount) || 0;

  useEffect(() => {
    if (tab !== 'discussion' || !discussionKey) return undefined;
    if (readMarkedKey === discussionKey) return undefined;
    // Nothing unread means nothing to mark — and the server no-ops this for
    // anyone outside the raiser/tester audience anyway. Skipping spares a POST
    // and a whole list refetch on every ticket the drawer opens.
    if (discussionUnread <= 0) return undefined;

    let cancelled = false;
    markDiscussionRead(ticket.ticketId)
      .then(() => {
        if (cancelled) return;
        setReadMarkedKey(discussionKey);
        // The list still has to refetch — its row chip is server-rendered.
        onChanged?.();
      })
      .catch((err) => {
        if (!isAbortError(err)) logApiError(normalizeApiError(err), { ticketId, operation: 'markDiscussionRead' });
      });
    return () => { cancelled = true; };
  }, [tab, ticket, ticketId, discussionKey, readMarkedKey, discussionUnread, onChanged]);

  const selectTab = useCallback((next) => {
    setTab(next);
    writeTabToUrl(next);
    requestAnimationFrame(() => {
      panelRefs[next]?.current?.focus();
    });
  }, []);

  const clearFieldError = useCallback((key) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const closeValidationDialog = useCallback(() => {
    const firstFieldId = validationDialog?.firstFieldId;
    setValidationDialog(null);
    if (firstFieldId) {
      window.setTimeout(() => {
        if (!document.getElementById(firstFieldId)) {
          selectTab('details');
        }
        window.setTimeout(() => document.getElementById(firstFieldId)?.focus(), 0);
      }, 0);
    }
  }, [validationDialog, selectTab]);

  const run = (operation, { rethrow = false } = {}) => async (...args) => {
    setError(null);
    setFieldErrors({});
    setValidationDialog(null);
    try {
      await operation(...args);
      await load();
      onChanged?.();
    } catch (err) {
      const apiError = normalizeApiError(err);
      if (isPatchFieldError(apiError)) {
        if (shouldLogApiError(apiError)) {
          logApiError(apiError, { ticketId, operation: operation.name || 'ticketAction' });
        }
        setFieldErrors(getPatchFieldErrors(apiError) || {});
      } else {
        await handleTransitionError(err, {
          ticket,
          onReload: async () => {
            await load();
            onChanged?.();
          },
          setError,
          setFieldErrors,
          setValidationDialog,
          logContext: { ticketId, operation: operation.name || 'ticketAction', surface: 'drawer' },
        });
      }
      if (rethrow) throw apiError ?? err;
    }
  };

  const watching = Boolean(
    ticket.watchers?.some((w) => String(w.id || w._id) === String(user?.id || user?._id)),
  );
  const canViewTicket = can(user, 'tickets.view', permissionContext) || isExternalUser(user);
  const canEditTicket = can(user, 'tickets.edit', permissionContext);
  const externalViewer = isExternalUser(user);
  const canComment = externalViewer ? canViewTicket : canEditTicket;
  const canManageOwnComments = canEditTicket || isExternalUser(user);
  const canAssign = Boolean(canEditTicket && !externalViewer);
  const canViewTeams = can(user, 'teams.view', permissionContext);
  const canDeleteTicket = can(user, 'tickets.delete', permissionContext);
  const canTransitionTicket = canChangeTicketStage(
    user, ticket, boardPolicy, permissionContext,
  );
  const canEditEstimates = hasAnyRole(user, ...ESTIMATE_DATE_EDITOR_ROLES);
  const canSeeMetadataRail = hasAnyRole(user, ...ESTIMATE_DATE_EDITOR_ROLES);
  const showMetadataRail = canSeeMetadataRail && tab === 'details';
  const onAssign = canAssign
    ? run((patch) => assignTicket(ticket.ticketId, {
      revision: ticket.revision,
      ...patch,
    }), { rethrow: true })
    : undefined;

  const assignment = useTicketAssignment({
    ticket,
    canAssign,
    canViewTeams,
    onAssign,
    eagerLoad: canAssign,
  });

  // A QA report is an internal judgement about the client's own ticket; the
  // API strips it from external responses, and the tab goes with it.
  const showQaTab = Boolean(user) && !isExternalUser(user);
  const rejectionCount = showQaTab ? qaRejections(ticket).length : 0;

  const TAB_ORDER = ['discussion', 'details', 'attachments', 'history', ...(showQaTab ? ['qa'] : [])];

  // Follow the URL's tab (a link, or the assistant switching it) when it names one this user has.
  useEffect(() => {
    if (urlTab && TAB_ORDER.includes(urlTab)) setTab(urlTab);
  }, [urlTab, showQaTab]);

  const onTabKeyDown = useCallback((event) => {
    const index = TAB_ORDER.indexOf(tab);
    let next = null;
    if (event.key === 'ArrowRight') next = TAB_ORDER[(index + 1) % TAB_ORDER.length];
    if (event.key === 'ArrowLeft') next = TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    if (event.key === 'Home') next = TAB_ORDER[0];
    if (event.key === 'End') next = TAB_ORDER[TAB_ORDER.length - 1];
    if (!next) return;
    event.preventDefault();
    setTab(next);
    writeTabToUrl(next);
    requestAnimationFrame(() => {
      const el = document.getElementById(`tab-${next}`);
      el?.focus();
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: still ? 'auto' : 'smooth' });
    });
  }, [tab]);

  return (
    <>
      {permissionsLoadFailed ? (
        <div className="drawer-permissions-banner" role="alert">
          Permissions could not load — actions may be unavailable.
          <button type="button" className="btn btn-sm" onClick={onRetryPermissions}>Retry</button>
        </div>
      ) : null}
      {projectBanner ? (
        <div className="drawer-project-banner" role="status">
          {projectBanner.message}
          <button type="button" className="btn btn-sm" onClick={projectBanner.onSwitch}>
            Switch to {projectBanner.projectName}
          </button>
        </div>
      ) : null}
      <div className="drawer-head">
        <TicketHeader
          ticket={ticket}
          watching={watching}
          canEdit={canEditTicket}
          canDelete={canDeleteTicket}
          onRequestDelete={() => setDeleteOpen(true)}
          onClose={onClose}
          notifications={<TicketNotificationControl ticket={ticket} user={user} />}
          onToggleWatch={run(() => (watching
            ? unwatchTicket(ticket.ticketId)
            : watchTicket(ticket.ticketId)))}
        />
        <FormError error={error} />
        {ticket.blocked && (
          <p className="blocknote"><Icon name="alert" size={14} /><span>{ticket.blockerReason || 'Blocked'}</span>
          </p>
        )}
        <div className="drawer-rail">
          <h2 className="sr">Stage</h2>
          <TicketStageBar
            ticket={ticket}
            actor={user}
            boardPolicy={boardPolicy}
            permissionContext={permissionContext}
            onTransition={canTransitionTicket
              ? run((body) => transitionTicket(ticket.ticketId, body))
              : undefined}
          />
        </div>
        <div className="tabs" role="tablist" aria-label="Ticket detail" onKeyDown={onTabKeyDown}>
          <button
            type="button" className="tab" role="tab" id="tab-discussion"
            aria-selected={tab === 'discussion'}
            aria-controls="panel-discussion"
            tabIndex={tab === 'discussion' ? 0 : -1}
            onClick={() => selectTab('discussion')}
          >
            Discussion
            <span className="n">{ticket.comments?.length || 0}</span>
            {discussionUnread > 0 && (
              <span className="tab-unread" aria-label={`, ${discussionUnread} new ${discussionUnread === 1 ? 'reply' : 'replies'}`}>
                · {discussionUnread} new
              </span>
            )}
          </button>
          <button
            type="button" className="tab" role="tab" id="tab-details"
            aria-selected={tab === 'details'}
            aria-controls="panel-details"
            tabIndex={tab === 'details' ? 0 : -1}
            onClick={() => selectTab('details')}
          >
            Details
          </button>
          <button
            type="button" className="tab" role="tab" id="tab-attachments"
            aria-selected={tab === 'attachments'}
            aria-controls="panel-attachments"
            tabIndex={tab === 'attachments' ? 0 : -1}
            onClick={() => selectTab('attachments')}
          >
            Attachments
            <span className="n">{ticket.attachments?.length || 0}</span>
          </button>
          <button
            type="button" className="tab" role="tab" id="tab-history"
            aria-selected={tab === 'history'}
            aria-controls="panel-history"
            tabIndex={tab === 'history' ? 0 : -1}
            onClick={() => selectTab('history')}
          >
            History
          </button>
          {showQaTab && (
            <button
              type="button" className="tab" role="tab" id="tab-qa"
              aria-selected={tab === 'qa'}
              aria-controls="panel-qa"
              tabIndex={tab === 'qa' ? 0 : -1}
              onClick={() => selectTab('qa')}
            >
              QA Report
              <span className="n">{rejectionCount}</span>
            </button>
          )}
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
                  ticket={ticket}
                  user={user}
                  mentionCandidates={mentionCandidates}
                  discussionLastReadAt={ticket.discussionLastReadAt}
                  scrollToFirstUnread={tab === 'discussion'}
                  highlightCommentId={highlightCommentId}
                  canComment={canComment}
                  canEditComments={canManageOwnComments}
                  canDeleteComments={canManageOwnComments}
                  onAdd={canComment
                    ? run((body) => addComment(ticket.ticketId, body), { rethrow: true })
                    : undefined}
                  onUpload={canComment
                    ? run((form) => uploadAttachments(ticket.ticketId, form), { rethrow: true })
                    : undefined}
                  onEdit={canManageOwnComments
                    ? run((commentId, body) => editComment(ticket.ticketId, commentId, body), { rethrow: true })
                    : undefined}
                  onDelete={canManageOwnComments
                    ? run((commentId) => deleteComment(ticket.ticketId, commentId), { rethrow: true })
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
                <div className={`detail-tab${showMetadataRail ? ' detail-tab--with-rail' : ''}`}>
                  <TicketDetailsTab
                    ticket={ticket}
                    canAssign={canAssign}
                    canViewTeams={canViewTeams}
                    assignment={assignment}
                    railPresent={showMetadataRail}
                  />
                  {showMetadataRail && (
                    <TicketMetadataRail
                      ticket={ticket}
                      fieldErrors={fieldErrors}
                      onFieldEdit={clearFieldError}
                      canAssign={canAssign}
                      canViewTeams={canViewTeams}
                      canEditEstimates={canEditEstimates}
                      assignment={assignment}
                      onSave={run((body) => patchTicket(ticket.ticketId, body), { rethrow: true })}
                      onBlock={async () => {
                        if (!blockReason.trim()) return;
                        await run(() => setBlocked(ticket.ticketId, {
                          revision: ticket.revision,
                          reason: blockReason,
                        }))();
                        setBlockReason('');
                      }}
                      onUnblock={run(() => clearBlocked(ticket.ticketId, {
                        revision: ticket.revision,
                      }))}
                      blockReason={blockReason}
                      setBlockReason={setBlockReason}
                    />
                  )}
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
                  ticket={ticket}
                  user={user}
                  canUpload={canViewTicket}
                  canDelete={canDeleteTicket}
                  onUpload={canViewTicket
                    ? async (form) => {
                      await uploadAttachments(ticket.ticketId, form);
                      await load();
                      onChanged?.();
                    }
                    : undefined}
                  onDelete={canDeleteTicket
                    ? async (attachmentId) => {
                      await deleteAttachment(ticket.ticketId, attachmentId);
                      await load();
                      onChanged?.();
                    }
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
                <TicketHistory ticket={ticket} onOpenDiscussion={() => selectTab('discussion')} />
              </div>
              {showQaTab && (
                <div
                  id="panel-qa"
                  role="tabpanel"
                  aria-labelledby="tab-qa"
                  tabIndex={-1}
                  ref={qaRef}
                  hidden={tab !== 'qa'}
                >
                  <TicketQaReport ticket={ticket} />
                </div>
              )}
            </div>
          </main>
        </div>
      </div>

      <TicketDrawerFooter
        ticket={ticket}
        actor={user}
        boardPolicy={boardPolicy}
        permissionContext={permissionContext}
        onTransition={canTransitionTicket
          ? run(async ({ image, ...body }) => {
            // The report's screenshot goes up on /attachments first; the
            // transition endpoint links ids, it does not take files.
            if (image) {
              const form = new FormData();
              form.append('files', image);
              form.append('clientRef', crypto.randomUUID());
              const uploaded = await uploadAttachments(ticket.ticketId, form);
              body.attachmentIds = (uploaded || []).map((a) => a.id || a._id).filter(Boolean);
            }
            return transitionTicket(ticket.ticketId, body);
          })
          : undefined}
      />

      <ValidationDialog
        open={Boolean(validationDialog)}
        title={validationDialog?.title}
        message={validationDialog?.message}
        items={validationDialog?.items || []}
        onClose={closeValidationDialog}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={`Delete ${ticket.ticketId}?`}
        message="This cannot be undone."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={async () => {
          if (deleting) return;
          setDeleting(true);
          setError(null);
          try {
            await deleteTicket(ticket.ticketId);
            onChanged?.();
            onClose();
          } catch (err) {
            const apiError = normalizeApiError(err);
            logApiError(apiError, { ticketId, operation: 'deleteTicket' });
            setError(apiError);
            setDeleteOpen(false);
          } finally {
            setDeleting(false);
          }
        }}
        onCancel={() => {
          if (deleting) return;
          setDeleteOpen(false);
        }}
      />
    </>
  );
}

/**
 * Keeps the open tab in the address bar, so a reload or a shared link lands on
 * it and the assistant knows where the user is. Only where the URL drives the
 * drawer (it names the ticket); Discussion, the default, stays out of the URL.
 */
function writeTabToUrl(next) {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(TICKET_PARAM)) return;
  if (next === 'discussion') params.delete(TAB_PARAM);
  else params.set(TAB_PARAM, next);
  const search = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
}

export default function TicketDetailDrawer({
  ticketId, onClose, onChanged, highlightCommentId = null, refreshNonce = 0,
}) {
  const { user } = useAuth();
  const { policy: boardPolicy } = useBoardPolicy();
  const { permissionContext, retryPermissions } = usePermissionContext();
  const { activeProjectId, setActiveProjectId } = useProject();
  const loadSeqRef = useRef(0);
  const loadAbortRef = useRef(null);
  const drawerRef = useRef(null);
  const openerRef = useRef(null);
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);

  // `quiet` keeps the currently rendered ticket on screen while refetching. The
  // normal path blanks it first so a switch between tickets never shows the old
  // one; a background refresh has no such switch and must not flash the loader.
  const load = useCallback(async ({ quiet = false } = {}) => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const seq = ++loadSeqRef.current;
    if (!quiet) setTicket(null);
    try {
      const next = await getTicket(ticketId, { signal: controller.signal });
      if (seq !== loadSeqRef.current || controller.signal.aborted) return null;
      setTicket(next);
      setError(null);
      return next;
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return null;
      if (seq !== loadSeqRef.current) return null;
      throw err;
    }
  }, [ticketId]);

  // Every refetch from inside the open drawer keeps the ticket on screen. Only
  // the ticketId switch below blanks it; doing it for an in-place action slid
  // the whole drawer out and back in on each status change.
  const reload = useCallback(() => load({ quiet: true }), [load]);

  useEffect(() => () => loadAbortRef.current?.abort(), []);

  useEffect(() => { load().catch(setError); }, [load]);

  // A live comment on the open ticket. Errors stay silent: the drawer is still
  // showing a good ticket, and the next load reports any real problem.
  useEffect(() => {
    if (!refreshNonce) return;
    load({ quiet: true }).catch(() => {});
  }, [refreshNonce, load]);

  const ticketProjectId = ticket?.project?.id || ticket?.project?._id;
  const projectMismatch = Boolean(
    ticketProjectId && String(ticketProjectId) !== String(activeProjectId),
  );
  const projectBanner = projectMismatch ? {
    projectName: ticket.project?.name || 'this project',
    message: `This ticket belongs to ${ticket.project?.name || 'another project'}.`,
    onSwitch: () => setActiveProjectId(String(ticketProjectId)),
  } : null;

  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [ticketId]);

  useEffect(() => {
    if (!ticket) return;
    drawerRef.current?.focus();
  }, [ticket, ticketId]);

  useEffect(() => {
    const node = drawerRef.current;
    if (!ticket || !node) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        if (nestedDialogOpen(node)) return;
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      if (nestedDialogOpen(node)) return;

      const focusables = node.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [ticket, ticketId, onClose]);

  return (
    <>
      <div
        className={`scrim${ticket ? ' on' : ''}`}
        onClick={ticket ? onClose : undefined}
        aria-hidden={!ticket}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ticket ? `Ticket ${ticket.ticketId}` : 'Ticket detail'}
        ref={drawerRef}
        tabIndex={-1}
        className={`ticket-drawer drawer${ticket ? ' on' : ''}`}
      >
        {!ticket && (
          <div className="drawer-body">
            {error ? <FormError error={error} /> : <AppLoader inline />}
          </div>
        )}
        {ticket && (
          <TicketDrawerContent
            ticket={ticket}
            user={user}
            ticketId={ticketId}
            onClose={onClose}
            onChanged={onChanged}
            load={reload}
            boardPolicy={boardPolicy}
            permissionContext={permissionContextForUi(permissionContext)}
            permissionsLoadFailed={permissionContext.loadFailed}
            onRetryPermissions={retryPermissions}
            projectBanner={projectBanner}
            highlightCommentId={highlightCommentId}
          />
        )}
      </aside>
    </>
  );
}
