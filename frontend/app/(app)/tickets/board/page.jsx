'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { LANES, laneOf } from '@pms/shared';
import { listTickets, transitionTicket, getTicket } from '@/shared/api/tickets.js';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { ticketFromSearch, withTicketParam, withoutTicketParam } from '@/shared/lib/deep-link.js';
import BoardLane from '@/shared/components/tickets/board-lane.jsx';
import TicketDetailDrawer from '@/shared/components/tickets/ticket-detail-drawer.jsx';
import FormError from '@/shared/components/form-error.jsx';
import Icon from '@/shared/components/icons.jsx';
function BoardPage() {
  const { activeProjectId } = useProject();
  const [tickets, setTickets] = useState([]);
  const [mine, setMine] = useState(false);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [error, setError] = useState(null);

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

  async function onDropTicket(ticketId, to) {
    setError(null);
    try {
      const current = await getTicket(ticketId);
      await transitionTicket(ticketId, { to, revision: current.revision });
      reload();
    } catch (err) {
      setError(err);
      reload();
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

      <FormError error={error} />

      <div className="board">
        {LANES.map((lane) => (
          <BoardLane
            key={lane.key}
            lane={lane}
            tickets={byLane[lane.key] || []}
            onOpen={open}
            onDropTicket={onDropTicket}
          />
        ))}
      </div>

      {openTicketId && (
        <TicketDetailDrawer ticketId={openTicketId} onClose={close} onChanged={reload} />
      )}
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
