'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ROLE_IDS, ADMIN_ROLES, ESTIMATE_DATE_EDITOR_ROLES, hasAnyRole, isExternalUser,
} from '@pms/shared';
import {
  getTicket, patchTicket, transitionTicket, addComment, editComment, deleteComment, uploadAttachments, deleteAttachment, assignTicket,
  watchTicket, unwatchTicket, setBlocked, clearBlocked,
} from '@/shared/api/tickets.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { useProject } from '@/shared/contexts/project-context.jsx';
import Icon from '@/shared/components/icons.jsx';
import FormError from '@/shared/components/form-error.jsx';
import ValidationDialog from '@/shared/components/validation-dialog.jsx';
import {
  getTransitionFieldErrors,
  getValidationDialogForTransitionError,
  getPatchFieldErrors,
  isPatchFieldError,
  isTransitionValidationError,
  logApiError,
  normalizeApiError,
} from '@/shared/lib/api-error.js';
import TicketHeader from './ticket-header.jsx';
import TicketDetailsTab from './ticket-details-tab.jsx';
import TicketAttachmentsTab from './ticket-attachments-tab.jsx';
import TicketMetadataRail from './ticket-metadata-rail.jsx';
import TicketStageBar from './ticket-stage-bar.jsx';
import TicketHistory from './ticket-history.jsx';
import TicketComments from './ticket-comments.jsx';
import TicketQaReport, { qaRejections } from './ticket-qa-report.jsx';
import TicketDrawerFooter from './ticket-drawer-footer.jsx';
import { useTicketAssignment } from './use-ticket-assignment.js';
import AppLoader from '../app-loader.jsx';

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
}) {
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [validationDialog, setValidationDialog] = useState(null);
  const [tab, setTab] = useState('discussion');
  const [blockReason, setBlockReason] = useState('');
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

  const selectTab = useCallback((next) => {
    setTab(next);
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
      logApiError(apiError, { ticketId, operation: operation.name || 'ticketAction' });

      if (isTransitionValidationError(apiError)) {
        setFieldErrors(getTransitionFieldErrors(apiError, ticket) || {});
        setValidationDialog(getValidationDialogForTransitionError(apiError, ticket));
      } else if (isPatchFieldError(apiError)) {
        setFieldErrors(getPatchFieldErrors(apiError) || {});
      } else {
        setError(apiError);
      }

      if (apiError.status === 409) await load();
      if (rethrow) throw apiError;
    }
  };

  const watching = Boolean(
    ticket.watchers?.some((w) => String(w.id || w._id) === String(user?.id || user?._id)),
  );
  const canAssign = hasAnyRole(user, ...ADMIN_ROLES, ROLE_IDS.PROJECT_ADMIN);
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
    onAssign,
    eagerLoad: canAssign,
  });

  // A QA report is an internal judgement about the client's own ticket; the
  // API strips it from external responses, and the tab goes with it.
  const showQaTab = Boolean(user) && !isExternalUser(user);
  const rejectionCount = showQaTab ? qaRejections(ticket).length : 0;

  const TAB_ORDER = ['discussion', 'details', 'attachments', 'history', ...(showQaTab ? ['qa'] : [])];

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
    requestAnimationFrame(() => {
      const el = document.getElementById(`tab-${next}`);
      el?.focus();
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: still ? 'auto' : 'smooth' });
    });
  }, [tab]);

  return (
    <>
      <div className="drawer-head">
        <TicketHeader
          ticket={ticket}
          watching={watching}
          onClose={onClose}
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
            onTransition={run((body) => transitionTicket(ticket.ticketId, body))}
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
                  onAdd={run((body) => addComment(ticket.ticketId, body), { rethrow: true })}
                  onUpload={run((form) => uploadAttachments(ticket.ticketId, form), { rethrow: true })}
                  onEdit={run((commentId, body) => editComment(ticket.ticketId, commentId, body), { rethrow: true })}
                  onDelete={run((commentId) => deleteComment(ticket.ticketId, commentId), { rethrow: true })}
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
                    assignment={assignment}
                    railPresent={showMetadataRail}
                  />
                  {showMetadataRail && (
                    <TicketMetadataRail
                      ticket={ticket}
                      fieldErrors={fieldErrors}
                      onFieldEdit={clearFieldError}
                      canAssign={canAssign}
                      canEditEstimates={canEditEstimates}
                      assignment={assignment}
                      onSave={run((body) => patchTicket(ticket.ticketId, body))}
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
                  onUpload={async (form) => {
                    await uploadAttachments(ticket.ticketId, form);
                    await load();
                    onChanged?.();
                  }}
                  onDelete={async (attachmentId) => {
                    await deleteAttachment(ticket.ticketId, attachmentId);
                    await load();
                    onChanged?.();
                  }}
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
        onTransition={run(async ({ image, ...body }) => {
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
        })}
      />

      <ValidationDialog
        open={Boolean(validationDialog)}
        title={validationDialog?.title}
        message={validationDialog?.message}
        items={validationDialog?.items || []}
        onClose={closeValidationDialog}
      />
    </>
  );
}

export default function TicketDetailDrawer({ ticketId, onClose, onChanged }) {
  const { user } = useAuth();
  const { activeProjectId, setActiveProjectId } = useProject();
  const activeProjectIdRef = useRef(activeProjectId);
  const drawerRef = useRef(null);
  const openerRef = useRef(null);
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);

  activeProjectIdRef.current = activeProjectId;

  const load = useCallback(async () => {
    setTicket(await getTicket(ticketId));
  }, [ticketId]);

  useEffect(() => {
    if (!ticket) return;
    const projectId = ticket.project?.id || ticket.project?._id;
    if (projectId && String(projectId) !== String(activeProjectIdRef.current)) {
      setActiveProjectId(String(projectId));
    }
  }, [ticket, setActiveProjectId]);

  useEffect(() => { load().catch(setError); }, [load]);

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
      <div className={`scrim${ticket ? ' on' : ''}`} onClick={onClose} />
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
            load={load}
          />
        )}
      </aside>
    </>
  );
}
