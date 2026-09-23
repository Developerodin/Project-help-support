'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useHistorySearch } from '@/shared/lib/use-history-search.js';
import {
  LANES,
  laneOf,
  wouldFailOwnershipGuard,
  canDragTicket,
  canInteractWithBoard,
  canTransition,
  getBoardDragBlockReason,
  getBoardMoveBlockReason,
  getBoardMoveTargets,
  getBoardReadOnlyNotice,
} from '@pms/shared';
import { transitionTicket, getTicket } from '@/shared/api/tickets.js';
import { listAllTickets } from '@/shared/lib/list-all-tickets.js';
import { isAbortError } from '@/shared/api/client.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { useTicketPreferences } from '@/shared/contexts/ticket-preferences-context.jsx';
import { buildTicketListQuery, boardMineFromSearch, withBoardMineParam } from '@/shared/lib/ticket-list-query.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { handleBoardBlockReason, handleTransitionError } from '@/shared/lib/handle-transition-error.js';
import { showToast } from '@/shared/lib/toast.js';
import AppLoader from '@/shared/components/app-loader.jsx';
import { useBoardPolicy } from '@/shared/hooks/use-board-policy.js';
import { usePermissionContext } from '@/shared/hooks/use-permission-context.js';
import {
  commentFromLocation,
  ticketFromSearch,
  withTicketParam,
  withoutTicketParam,
} from '@/shared/lib/deep-link.js';
import { OWNERSHIP_REQUIRED_MESSAGE } from '@/shared/lib/api-error.js';
import BoardLane from '@/shared/components/tickets/board-lane.jsx';
import TicketDetailDrawer from '@/shared/components/tickets/ticket-detail-drawer.jsx';
import FormError from '@/shared/components/form-error.jsx';
import ValidationDialog from '@/shared/components/validation-dialog.jsx';
import RemarkDialog from '@/shared/components/remark-dialog.jsx';
import Icon from '@/shared/components/icons.jsx';
import { REALTIME_BACKSTOP_MS } from '@/shared/hooks/use-ticket-realtime.js';
import { useRealtime, useRealtimeEvent } from '@/shared/contexts/realtime-context.jsx';
import { useNotificationPollInterval } from '@/shared/lib/notification-swr.js';

function BoardPage() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { policy: boardPolicy } = useBoardPolicy();
  const { permissionContext } = usePermissionContext();
  const { activeProjectId } = useProject();
  const {
    ready,
    preferences,
    boardMine: savedBoardMine,
    setBoardMine,
  } = useTicketPreferences();
  const [tickets, setTickets] = useState([]);
  const [boardTruncated, setBoardTruncated] = useState(false);
  const [boardTotalResults, setBoardTotalResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [movingTicketId, setMovingTicketId] = useState(null);
  const [draggingTicket, setDraggingTicket] = useState(null);
  const [validationDialog, setValidationDialog] = useState(null);
  const [validationTicketId, setValidationTicketId] = useState(null);
  const searchString = useHistorySearch();
  const openTicketId = ticketFromSearch(searchString);
  const highlightCommentId = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return commentFromLocation(searchString, window.location.hash);
  }, [searchString]);
  const [error, setError] = useState(null);
  const [readOnlyNoticeDismissed, setReadOnlyNoticeDismissed] = useState(false);
  const loadController = useRef(null);
  const normalizedBoardMineUrl = useRef(false);
  const ticketCountRef = useRef(0);
  ticketCountRef.current = tickets.length;

  const writeSearch = useCallback((nextSearch, { push = false } = {}) => {
    const url = `${pathname}${nextSearch}`;
    if (push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, [pathname]);

  const drawerOpenedFrom = useRef(null);

  useEffect(() => {
    if (!ready || normalizedBoardMineUrl.current) return;
    normalizedBoardMineUrl.current = true;
    if (new URLSearchParams(window.location.search).has('mine')) {
      const fromUrl = boardMineFromSearch(window.location.search);
      if (fromUrl !== savedBoardMine) setBoardMine(fromUrl);
      return;
    }
    const next = withBoardMineParam(window.location.search, savedBoardMine);
    if (next !== window.location.search) writeSearch(next);
  }, [ready, savedBoardMine, setBoardMine, writeSearch]);

  const handleBoardMineChange = (nextBoardMine) => {
    writeSearch(withBoardMineParam(window.location.search, nextBoardMine));
    setBoardMine(nextBoardMine);
  };
  // Mirrors ticket-drawer-footer.jsx's pending {to, kind} pattern: 'reason'
  // for a close, 'note' for a reopen. One dialog, one state shape, for both.
  const [pendingAction, setPendingAction] = useState(null);
  const [remarkText, setRemarkText] = useState('');
  const [remarkBusy, setRemarkBusy] = useState(false);

  const boardInteractive = canInteractWithBoard(user, boardPolicy, permissionContext);
  const readOnlyNotice = useMemo(
    () => getBoardReadOnlyNotice(user, boardPolicy),
    [user, boardPolicy],
  );
  const showReadOnlyOverlay = Boolean(readOnlyNotice) && !readOnlyNoticeDismissed;

  const reload = useCallback(() => {
    if (!ready) return undefined;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const softReload = ticketCountRef.current > 0;
    if (softReload) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);

    const loadAll = async () => {
      const baseQuery = buildTicketListQuery({
        preferences,
        projectId: activeProjectId,
        scopeOverride: savedBoardMine ? 'assigned' : preferences.filters.scope,
      });
      const res = await listAllTickets(baseQuery, { signal: controller.signal });
      if (controller.signal.aborted) return null;
      setBoardTruncated(res.truncated);
      setBoardTotalResults(res.totalResults ?? res.results.length);
      return res.results;
    };

    return loadAll()
      .then((all) => {
        if (all) setTickets(all);
      })
      .catch((err) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        const message = normalizeApiError(err)?.message || 'Could not load board tickets';
        setLoadError(message);
        showToast(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      });
  }, [ready, preferences, savedBoardMine, activeProjectId]);

  useEffect(() => () => loadController.current?.abort(), []);

  const pollInterval = useNotificationPollInterval();
  // The list toast is suppressed for the ticket whose drawer is open, so that
  // drawer has to show the reply itself instead.
  const [drawerRefreshNonce, setDrawerRefreshNonce] = useState(0);
  const handleRealtimeEvent = useCallback((event) => {
    if (!event?.type) return;
    if (event.type !== 'ticket.comment' && event.type !== 'ticket.updated') return;
    if (activeProjectId && event.projectId && event.projectId !== activeProjectId) return;
    if (event.type === 'ticket.comment' && event.ticketId && event.ticketId === openTicketId) {
      setDrawerRefreshNonce((nonce) => nonce + 1);
    }
    reload();
  }, [reload, activeProjectId, openTicketId]);

  const { connected: realtimeConnected } = useRealtime();
  useRealtimeEvent(handleRealtimeEvent);

  useEffect(() => {
    if (!ready) return undefined;
    const timer = window.setInterval(
      () => reload(),
      realtimeConnected ? REALTIME_BACKSTOP_MS : pollInterval,
    );
    return () => window.clearInterval(timer);
  }, [ready, reload, pollInterval, realtimeConnected]);

  useEffect(() => {
    if (ready) reload();
  }, [reload, ready]);
  const tableViewHref = useMemo(() => {
    const params = new URLSearchParams();
    if (activeProjectId) params.set('project', activeProjectId);
    if (savedBoardMine) params.set('scope', 'assigned');
    const qs = params.toString();
    return qs ? `/tickets?${qs}` : '/tickets';
  }, [activeProjectId, savedBoardMine]);

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
    const result = handleBoardBlockReason(blockReason, { setError, showInfoToast: true });
    if (result.kind !== 'noop') setReadOnlyNoticeDismissed(true);
  }

  const getDropHint = useCallback((ticket, toStage) => {
    const block = getBoardMoveBlockReason(
      user, ticket, toStage, boardPolicy, permissionContext,
    );
    if (!block) return 'valid';
    if (block.code === 'SAME_STAGE') return 'invalid';
    return 'invalid';
  }, [user, boardPolicy, permissionContext]);

  async function performTransition(ticketId, to, revision, extra = {}) {
    await transitionTicket(ticketId, { to, revision, ...extra });
    reload();
  }

  async function onDropTicket(ticketId, to) {
    setError(null);
    setDraggingTicket(null);

    try {
      const cached = ticketById[ticketId];
      const current = cached || await getTicket(ticketId);

      const blockReason = getBoardMoveBlockReason(
        user, current, to, boardPolicy, permissionContext,
      );
      if (blockReason) {
        showMoveError(blockReason);
        return;
      }

      if (wouldFailOwnershipGuard(to, current)) {
        handleBoardBlockReason({
          code: 'OWNERSHIP_REQUIRED',
          message: OWNERSHIP_REQUIRED_MESSAGE,
        }, { setError });
        return;
      }

      const verdict = canTransition(
        current.status, to, user, current, boardPolicy, permissionContext,
      );
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

      setMovingTicketId(ticketId);
      try {
        await performTransition(ticketId, to, current.revision);
      } catch (err) {
        await handleTransitionError(err, {
          ticket: current,
          onReload: reload,
          setError,
          setValidationDialog: (dialog) => {
            setValidationDialog(dialog);
            setValidationTicketId(ticketId);
          },
          onOpenTicketForValidation: () => open(ticketId),
          logContext: { ticketId, surface: 'board' },
        });
      } finally {
        setMovingTicketId(null);
      }
    } catch (err) {
      await handleTransitionError(err, {
        onReload: reload,
        setError,
        logContext: { ticketId, surface: 'board' },
      });
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
      await handleTransitionError(err, {
        onReload: reload,
        setError,
        logContext: { ticketId: pendingAction?.ticketId, surface: 'board' },
      });
    } finally {
      setRemarkBusy(false);
    }
  }

  function onBlockedDrag(ticket) {
    if (ticket?.blocked) {
      showMoveError({
        code: 'TICKET_BLOCKED',
        message: ticket.blockerReason
          ? `This ticket is blocked: ${ticket.blockerReason}`
          : 'This ticket is blocked. Clear the blocker before moving it.',
        blockerReason: ticket.blockerReason,
      });
      return;
    }
    const blockReason = getBoardDragBlockReason(
      user, ticket, boardPolicy, permissionContext,
    );
    if (blockReason) showMoveError(blockReason);
  }

  const open = (ticketId) => {
    drawerOpenedFrom.current = window.location.search;
    writeSearch(withTicketParam(window.location.search, ticketId), { push: true });
  };

  const close = () => {
    const openedFrom = drawerOpenedFrom.current;
    drawerOpenedFrom.current = null;
    const without = withoutTicketParam(window.location.search);
    if (openedFrom === without) {
      window.history.back();
      return;
    }
    writeSearch(without);
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
          <button
            type="button"
            aria-pressed={!savedBoardMine}
            disabled={loading}
            onClick={() => handleBoardMineChange(false)}
          >
            Everyone
          </button>
          <button
            type="button"
            aria-pressed={savedBoardMine}
            disabled={loading}
            onClick={() => handleBoardMineChange(true)}
          >
            Mine
          </button>
        </div>
        <span className="resultline num" aria-live="polite">{tickets.length} tickets</span>
        <span className="spacer" />
        <Link href="/tickets" className="btn"><Icon name="list" size={13} /> Table view</Link>
      </div>

      <FormError
        error={error}
        title={error?.title}
        variant={error?.variant}
        onDismiss={error ? () => setError(null) : undefined}
      />

      {loadError ? (
        <p className="meta" role="alert">{loadError}</p>
      ) : null}

      {boardTruncated ? (
        <div className="board-truncation-banner" role="alert">
          <strong>Board list truncated</strong>
          <p>
            Loaded {tickets.length.toLocaleString()}
            {boardTotalResults != null ? ` of ${boardTotalResults.toLocaleString()}` : ''} tickets.
            Cards beyond the first 1,000 are hidden on the board.
          </p>
          <Link href={tableViewHref} className="btn btn-sm">Open filtered table view</Link>
        </div>
      ) : null}

      {loading && tickets.length === 0 ? (
        <AppLoader inline label="Loading board…" />
      ) : (
        <div className={`board-wrap${showReadOnlyOverlay ? ' board-wrap--locked' : ''}${refreshing ? ' board-wrap--refreshing' : ''}${loading && tickets.length === 0 ? ' board-wrap--busy' : ''}`} aria-busy={loading || movingTicketId || undefined}>
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
              getMoveTargets={(ticket) => getBoardMoveTargets(
                user, ticket, boardPolicy, permissionContext,
              )}
              canDrop={boardInteractive}
              canDragTicket={(ticket) => {
                if (ticket?.blocked) return false;
                return canDragTicket(
                  user, ticket, boardPolicy, permissionContext,
                );
              }}
              onBlockedDrag={onBlockedDrag}
              draggingTicket={draggingTicket}
              getDropHint={getDropHint}
              movingTicketId={movingTicketId}
              onDragStartTicket={setDraggingTicket}
              onDragEndTicket={() => setDraggingTicket(null)}
            />
          ))}
        </div>
      </div>
      )}

      {openTicketId && (
        <TicketDetailDrawer
          ticketId={openTicketId}
          onClose={close}
          onChanged={reload}
          highlightCommentId={highlightCommentId}
          refreshNonce={drawerRefreshNonce}
        />
      )}

      <ValidationDialog
        open={Boolean(validationDialog)}
        title={validationDialog?.title}
        message={validationDialog?.message}
        items={validationDialog?.items || []}
        onClose={() => {
          setValidationDialog(null);
          if (validationTicketId) open(validationTicketId);
          setValidationTicketId(null);
        }}
      />

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
