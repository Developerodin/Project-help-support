'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  LANES,
  laneOf,
  wouldFailOwnershipGuard,
  canDragTicket,
  canEditTicket,
  canInteractWithBoard,
  canTransition,
  getBoardMoveBlockReason,
  getBoardReadOnlyNotice,
  isExternalUser,
  stageLabel,
} from '@pms/shared';
import { listTickets, transitionTicket, getTicket } from '@/shared/api/tickets.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { ticketFromSearch, withTicketParam, withoutTicketParam } from '@/shared/lib/deep-link.js';
import { friendlyTransitionError, OWNERSHIP_REQUIRED_MESSAGE } from '@/shared/lib/api-error.js';
import BoardLane from '@/shared/components/tickets/board-lane.jsx';
import TicketDetailDrawer from '@/shared/components/tickets/ticket-detail-drawer.jsx';
import FormError from '@/shared/components/form-error.jsx';
import RemarkDialog from '@/shared/components/remark-dialog.jsx';
import Icon from '@/shared/components/icons.jsx';

function BoardPage() {
  const { user } = useAuth();
  const { activeProjectId } = useProject();
  const [tickets, setTickets] = useState([]);
  const [mine, setMine] = useState(false);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [error, setError] = useState(null);
  const [readOnlyNoticeDismissed, setReadOnlyNoticeDismissed] = useState(false);
  const [pendingClose, setPendingClose] = useState(null);
  const [closeReason, setCloseReason] = useState('');
  const [closeBusy, setCloseBusy] = useState(false);

  const boardInteractive = canInteractWithBoard(user);
  const readOnlyNotice = useMemo(() => getBoardReadOnlyNotice(user), [user]);
  const showReadOnlyOverlay = Boolean(readOnlyNotice) && !readOnlyNoticeDismissed;

  const reload = useCallback(() => {
    listTickets({
      limit: 100,
      scope: mine ? 'assigned' : 'all',
      project: activeProjectId || undefined,
    }).then((p) => setTickets(p.results));
  }, [mine, activeProjectId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setOpenTicketId(ticketFromSearch(window.location.search)); }, []);

  const byLane = useMemo(() => {
    const groups = Object.fromEntries(LANES.map((l) => [l.key, []]));
    for (const ticket of tickets) groups[laneOf(ticket.status)]?.push(ticket);
    return groups;
  }, [tickets]);

  const ticketById = useMemo(
    () => Object.fromEntries(tickets.map((ticket) => [ticket.ticketId, ticket])),
    [tickets],
  );

  function showMoveError(blockReason) {
    setError({
      code: blockReason.code,
      message: blockReason.message,
      title: blockReason.title,
    });
    setReadOnlyNoticeDismissed(true);
  }

  async function performTransition(ticketId, to, revision, extra = {}) {
    await transitionTicket(ticketId, { to, revision, ...extra });
    reload();
  }

  async function onDropTicket(ticketId, to) {
    setError(null);

    const cached = ticketById[ticketId];
    const current = cached || await getTicket(ticketId);

    const blockReason = getBoardMoveBlockReason(user, current, to);
    if (blockReason) {
      showMoveError(blockReason);
      return;
    }

    try {
      if (wouldFailOwnershipGuard(to, current)) {
        setError({
          status: 400,
          code: 'OWNERSHIP_REQUIRED',
          message: OWNERSHIP_REQUIRED_MESSAGE,
        });
        return;
      }

      const verdict = canTransition(current.status, to, user, current);
      if (verdict.isClose) {
        setPendingClose({ ticketId, to, revision: current.revision });
        setCloseReason('');
        return;
      }

      await performTransition(ticketId, to, current.revision);
    } catch (err) {
      setError(friendlyTransitionError(err));
      reload();
    }
  }

  async function confirmClose() {
    if (!pendingClose) return;
    setCloseBusy(true);
    try {
      await performTransition(
        pendingClose.ticketId,
        pendingClose.to,
        pendingClose.revision,
        { reason: closeReason.trim() },
      );
      setPendingClose(null);
      setCloseReason('');
    } catch (err) {
      setError(friendlyTransitionError(err));
      reload();
    } finally {
      setCloseBusy(false);
    }
  }

  function onBlockedDrag(ticket) {
    if (isExternalUser(user)) {
      if (ticket.status !== 'live') {
        showMoveError({
          code: 'CLIENT_BOARD_MOVE_FORBIDDEN',
          title: 'Cannot move this ticket',
          message: `You don't have permission to move this ticket from ${stageLabel(ticket.status)}. Clients can only close tickets that are Live.`,
        });
        return;
      }
    }

    const readOnly = getBoardReadOnlyNotice(user);
    if (readOnly) {
      showMoveError(readOnly);
      return;
    }

    if (!canEditTicket(user, ticket)) {
      showMoveError({
        code: 'TICKET_EDIT_FORBIDDEN',
        title: 'Cannot move this ticket',
        message: 'You don\'t have permission to move this ticket. Only the reporter, assignee, Project Admin, or Admin can change its stage.',
      });
    }
  }

  const open = (ticketId) => {
    setOpenTicketId(ticketId);
    window.history.replaceState(null, '', withTicketParam(window.location.search, ticketId));
  };

  const close = () => {
    setOpenTicketId(null);
    window.history.replaceState(
      null, '', `/tickets/board${withoutTicketParam(window.location.search)}`,
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Board</h1>
          <p className="sub">Ten stages, grouped into five lanes. Dropping a card into a lane moves it to that lane&apos;s first stage, or refuses and says why.</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Whose tickets">
          <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>Everyone</button>
          <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>Mine</button>
        </div>
        <span className="resultline num">{tickets.length} tickets</span>
        <span className="spacer" />
        <Link href="/tickets" className="btn"><Icon name="list" size={13} /> Table view</Link>
      </div>

      <FormError
        error={error}
        title={error?.title || (error?.code === 'CLIENT_BOARD_MOVE_FORBIDDEN' ? 'Cannot move this ticket' : undefined)}
        onDismiss={error ? () => setError(null) : undefined}
      />

      <div className={`board-wrap${showReadOnlyOverlay ? ' board-wrap--locked' : ''}`}>
        {showReadOnlyOverlay && (
          <div
            className="board-lock-overlay"
            role="alert"
            aria-live="polite"
            aria-labelledby="board-lock-title"
            aria-describedby="board-lock-message"
          >
            <div className="board-lock-overlay__panel">
              <div className="board-lock-overlay__head">
                <Icon name="alert" size={18} aria-hidden="true" />
                <h2 id="board-lock-title">{readOnlyNotice.title}</h2>
              </div>
              <p id="board-lock-message">{readOnlyNotice.message}</p>
              <div className="board-lock-overlay__actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setReadOnlyNoticeDismissed(true)}
                >
                  Dismiss
                </button>
                <Link href="/tickets" className="btn btn-sm">Open table view</Link>
              </div>
            </div>
          </div>
        )}

        <div className="board" aria-hidden={showReadOnlyOverlay || undefined}>
          {LANES.map((lane) => (
            <BoardLane
              key={lane.key}
              lane={lane}
              tickets={byLane[lane.key] || []}
              onOpen={open}
              onDropTicket={onDropTicket}
              canDrop={boardInteractive}
              canDragTicket={(ticket) => canDragTicket(user, ticket)}
              onBlockedDrag={onBlockedDrag}
            />
          ))}
        </div>
      </div>

      {openTicketId && (
        <TicketDetailDrawer ticketId={openTicketId} onClose={close} onChanged={reload} />
      )}

      <RemarkDialog
        open={Boolean(pendingClose)}
        title={`Close ${pendingClose?.ticketId || ''}`}
        label="Reason (required to close)"
        value={closeReason}
        onChange={(event) => setCloseReason(event.target.value)}
        busy={closeBusy}
        onConfirm={confirmClose}
        onCancel={() => {
          if (closeBusy) return;
          setPendingClose(null);
          setCloseReason('');
        }}
      />
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="meta">Loading…</p>}>
      <BoardPage />
    </Suspense>
  );
}
