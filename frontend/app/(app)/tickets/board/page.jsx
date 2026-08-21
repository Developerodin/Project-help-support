'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  LANES,
  laneOf,
  wouldFailOwnershipGuard,
  canDragTicket,
  canInteractWithBoard,
  canTransition,
  getBoardDragBlockReason,
  getBoardMoveBlockReason,
  getBoardReadOnlyNotice,
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
  // Mirrors ticket-drawer-footer.jsx's pending {to, kind} pattern: 'reason'
  // for a close, 'note' for a reopen. One dialog, one state shape, for both.
  const [pendingAction, setPendingAction] = useState(null);
  const [remarkText, setRemarkText] = useState('');
  const [remarkBusy, setRemarkBusy] = useState(false);

  const boardInteractive = canInteractWithBoard(user);
  const readOnlyNotice = useMemo(() => getBoardReadOnlyNotice(user), [user]);
  const showReadOnlyOverlay = Boolean(readOnlyNotice) && !readOnlyNoticeDismissed;

  const reload = useCallback(() => {
    // A board has to lane EVERY ticket, so it pages through rather than stopping
    // at the API's 100-row ceiling and silently hiding the rest.
    // ponytail: capped at 10 pages. Past 1000 tickets a board is the wrong tool
    // and this wants server-side lane counts instead of fetching the lot.
    const loadAll = async () => {
      const all = [];
      for (let p = 1; p <= 10; p += 1) {
        // eslint-disable-next-line no-await-in-loop -- page N+1 needs N's totalPages
        const res = await listTickets({
          limit: 100,
          page: p,
          scope: mine ? 'assigned' : 'all',
          project: activeProjectId || undefined,
        });
        all.push(...res.results);
        if (p >= (res.totalPages || 1)) break;
      }
      return all;
    };
    loadAll().then(setTickets);
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

    try {
      const cached = ticketById[ticketId];
      const current = cached || await getTicket(ticketId);

      const blockReason = getBoardMoveBlockReason(user, current, to);
      if (blockReason) {
        showMoveError(blockReason);
        return;
      }

      if (wouldFailOwnershipGuard(to, current)) {
        setError({
          status: 400,
          code: 'OWNERSHIP_REQUIRED',
          message: OWNERSHIP_REQUIRED_MESSAGE,
        });
        return;
      }

      const verdict = canTransition(current.status, to, user, current);
      if (verdict.isClose || verdict.isReopen) {
        setPendingAction({
          ticketId, to, revision: current.revision, kind: verdict.isReopen ? 'note' : 'reason',
          // Same wording as the drawer. A screenshot needs the drawer's
          // upload step, so a drag off the board takes the note alone.
          back: verdict.decision === 'rejected' ? 'Reject' : 'Reopen',
        });
        setRemarkText('');
        return;
      }

      await performTransition(ticketId, to, current.revision);
    } catch (err) {
      setError(friendlyTransitionError(err));
      reload();
    }
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    setRemarkBusy(true);
    try {
      await performTransition(
        pendingAction.ticketId,
        pendingAction.to,
        pendingAction.revision,
        { [pendingAction.kind]: remarkText.trim() },
      );
      setPendingAction(null);
      setRemarkText('');
    } catch (err) {
      setError(friendlyTransitionError(err));
      reload();
    } finally {
      setRemarkBusy(false);
    }
  }

  function onBlockedDrag(ticket) {
    const blockReason = getBoardDragBlockReason(user, ticket);
    if (blockReason) showMoveError(blockReason);
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
            role="status"
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

        <div className="board">
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
        open={Boolean(pendingAction)}
        title={`${pendingAction?.kind === 'note' ? pendingAction.back : 'Close'} ${pendingAction?.ticketId || ''}`}
        label={pendingAction?.kind === 'note'
          ? `${pendingAction.back === 'Reject' ? 'QA report' : 'Note'} (required to ${pendingAction.back.toLowerCase()})`
          : 'Reason (required to close)'}
        confirmLabel={pendingAction?.kind === 'note' ? pendingAction.back : 'Close'}
        value={remarkText}
        onChange={(event) => setRemarkText(event.target.value)}
        busy={remarkBusy}
        onConfirm={confirmPendingAction}
        onCancel={() => {
          if (remarkBusy) return;
          setPendingAction(null);
          setRemarkText('');
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
