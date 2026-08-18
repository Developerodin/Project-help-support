'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ROLE_IDS, ADMIN_ROLES, ESTIMATE_DATE_EDITOR_ROLES, hasAnyRole } from '@pms/shared';
import {
  getTicket, patchTicket, transitionTicket, addComment, uploadAttachments, deleteAttachment, assignTicket,
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
import TicketDrawerFooter from './ticket-drawer-footer.jsx';
import { useTicketAssignment } from './use-ticket-assignment.js';
import AppLoader from '../app-loader.jsx';

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
  const [railCollapsed, setRailCollapsed] = useState(false);
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

  const selectTab = useCallback((next) => {
    setTab(next);
    requestAnimationFrame(() => {
      panelRefs[next]?.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setRailCollapsed(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
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
      window.setTimeout(() => document.getElementById(firstFieldId)?.focus(), 0);
    }
  }, [validationDialog]);

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
  const canSeeMetadataRail = hasAnyRole(user, ...ADMIN_ROLES, ROLE_IDS.DEVELOPER);
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
      </div>

      <div className="drawer-body">
        <div className={`ticket-workspace${showMetadataRail ? '' : ' ticket-workspace--full'}`}>
          <main className="ticket-main">
            <div className="tabs" role="tablist" aria-label="Ticket detail">
              <button
                type="button" className="tab" role="tab" id="tab-discussion"
                aria-selected={tab === 'discussion'}
                aria-controls="panel-discussion"
                onClick={() => selectTab('discussion')}
              >
                Discussion
                <span className="n">{ticket.comments?.length || 0}</span>
              </button>
              <button
                type="button" className="tab" role="tab" id="tab-details"
                aria-selected={tab === 'details'}
                aria-controls="panel-details"
                onClick={() => selectTab('details')}
              >
                Details
              </button>
              <button
                type="button" className="tab" role="tab" id="tab-attachments"
                aria-selected={tab === 'attachments'}
                aria-controls="panel-attachments"
                onClick={() => selectTab('attachments')}
              >
                Attachments
                <span className="n">{ticket.attachments?.length || 0}</span>
              </button>
              <button
                type="button" className="tab" role="tab" id="tab-history"
                aria-selected={tab === 'history'}
                aria-controls="panel-history"
                onClick={() => selectTab('history')}
              >
                History
              </button>
            </div>

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
                  onAdd={run((body) => addComment(ticket.ticketId, body), { rethrow: true })}
                  onUpload={run((form) => uploadAttachments(ticket.ticketId, form), { rethrow: true })}
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
                <TicketDetailsTab
                  ticket={ticket}
                  canAssign={canAssign}
                  assignment={assignment}
                />
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
                <TicketHistory ticket={ticket} />
              </div>
            </div>
          </main>

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
              collapsed={railCollapsed}
              onToggleCollapsed={() => setRailCollapsed((prev) => !prev)}
            />
          )}
        </div>
      </div>

      <TicketDrawerFooter
        ticket={ticket}
        actor={user}
        onTransition={run((body) => transitionTicket(ticket.ticketId, body))}
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
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className={`scrim${ticket ? ' on' : ''}`} onClick={onClose} />
      <aside
        role="dialog"
        aria-label={ticket ? `Ticket ${ticket.ticketId}` : 'Ticket detail'}
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
