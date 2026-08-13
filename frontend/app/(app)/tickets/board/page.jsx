'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { LANES, laneOf } from '@pms/shared';
import { listTickets, transitionTicket, getTicket } from '@/shared/api/tickets.js';
import { ticketFromSearch, withTicketParam, withoutTicketParam } from '@/shared/lib/deep-link.js';
import BoardLane from '@/shared/components/tickets/board-lane.jsx';
import TicketDetailDrawer from '@/shared/components/tickets/ticket-detail-drawer.jsx';
import FormError from '@/shared/components/form-error.jsx';

function BoardPage() {
  const [tickets, setTickets] = useState([]);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    listTickets({ limit: 100 }).then((p) => setTickets(p.results));
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setOpenTicketId(ticketFromSearch(window.location.search)); }, []);

  const byLane = useMemo(() => {
    const groups = Object.fromEntries(LANES.map((l) => [l.key, []]));
    for (const ticket of tickets) groups[laneOf(ticket.status)].push(ticket);
    return groups;
  }, [tickets]);

  async function onDropTicket(ticketId, to) {
    setError(null);
    try {
      // The revision is read fresh: the card in hand may be stale, and the
      // server answers 409 rather than applying a stale write.
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
      <h1>Board</h1>
      <FormError error={error} />

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {LANES.map((lane) => (
          <BoardLane
            key={lane.key}
            lane={lane}
            tickets={byLane[lane.key]}
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
    <Suspense fallback={<p>Loading…</p>}>
      <BoardPage />
    </Suspense>
  );
}
