'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { LANES, laneOf } from '@pms/shared';
import { listTickets } from '@/shared/api/tickets.js';
import { listProjects } from '@/shared/api/projects.js';
import { ticketFromSearch, withTicketParam, withoutTicketParam } from '@/shared/lib/deep-link.js';
import TicketFilters from '@/shared/components/tickets/ticket-filters.jsx';
import TicketTable from '@/shared/components/tickets/ticket-table.jsx';
import StatsStrip from '@/shared/components/tickets/stats-strip.jsx';
import TicketDetailDrawer from '@/shared/components/tickets/ticket-detail-drawer.jsx';

function TicketListPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState({ scope: 'all', page: 1, limit: 25 });
  const [page, setPage] = useState({ results: [], totalResults: 0 });
  const [projects, setProjects] = useState([]);
  const [openTicketId, setOpenTicketId] = useState(null);

  // Opening the URL directly must open the drawer with the list underneath.
  useEffect(() => {
    const search = searchParams.toString();
    setOpenTicketId(ticketFromSearch(search ? `?${search}` : ''));
  }, [searchParams]);

  useEffect(() => { listProjects().then((p) => setProjects(p.results)); }, []);

  const reload = useCallback(() => { listTickets(filters).then(setPage); }, [filters]);
  useEffect(() => { reload(); }, [reload]);

  const counts = useMemo(() => {
    const byLane = Object.fromEntries(LANES.map((l) => [l.key, 0]));
    for (const ticket of page.results) byLane[laneOf(ticket.status)] += 1;
    return byLane;
  }, [page.results]);

  const open = (ticketId) => {
    setOpenTicketId(ticketId);
    // replaceState, not a route push: the drawer is not a page.
    window.history.replaceState(null, '', withTicketParam(window.location.search, ticketId));
  };

  const close = () => {
    setOpenTicketId(null);
    window.history.replaceState(
      null, '', `${pathname}${withoutTicketParam(window.location.search)}`,
    );
  };

  return (
    <>
      <h1>Tickets</h1>
      <StatsStrip
        counts={counts}
        onSelectLane={(lane) => setFilters({ ...filters, status: lane.stages[0], page: 1 })}
      />
      <TicketFilters value={filters} projects={projects} onChange={setFilters} />
      <TicketTable tickets={page.results} onOpen={open} />
      <p style={{ color: 'var(--muted)' }}>{page.totalResults} tickets</p>

      {openTicketId && (
        <TicketDetailDrawer ticketId={openTicketId} onClose={close} onChanged={reload} />
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <TicketListPage />
    </Suspense>
  );
}
