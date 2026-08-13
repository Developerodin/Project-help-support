'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { listTickets } from '@/shared/api/tickets.js';
import { listProjects } from '@/shared/api/projects.js';
import { ticketFromSearch, withTicketParam, withoutTicketParam } from '@/shared/lib/deep-link.js';
import TicketFilters from '@/shared/components/tickets/ticket-filters.jsx';
import TicketTable from '@/shared/components/tickets/ticket-table.jsx';
import TicketDetailDrawer from '@/shared/components/tickets/ticket-detail-drawer.jsx';

function TicketListPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState({ scope: 'all', page: 1, limit: 25 });
  const [page, setPage] = useState({ results: [], totalResults: 0, page: 1, totalPages: 1 });
  const [projects, setProjects] = useState([]);
  const [openTicketId, setOpenTicketId] = useState(null);

  useEffect(() => {
    const search = searchParams.toString();
    setOpenTicketId(ticketFromSearch(search ? `?${search}` : ''));
  }, [searchParams]);

  useEffect(() => { listProjects().then((p) => setProjects(p.results)); }, []);

  const reload = useCallback(() => { listTickets(filters).then(setPage); }, [filters]);
  useEffect(() => { reload(); }, [reload]);

  const open = (ticketId) => {
    setOpenTicketId(ticketId);
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
      <div className="page-head">
        <div>
          <h1>Tickets</h1>
          <p className="sub">Every ticket across Web App and Mobile App. Searching for a ticket number jumps straight to it.</p>
        </div>
      </div>

      <TicketFilters value={filters} projects={projects} onChange={setFilters} />
      <TicketTable tickets={page.results} onOpen={open} />

      <div className="pager">
        <span className="of">{page.totalResults} tickets</span>
        <span className="spacer" />
        <button
          type="button" className="pagebtn" disabled={(page.page || 1) <= 1}
          onClick={() => setFilters({ ...filters, page: (filters.page || 1) - 1 })}
        >
          Prev
        </button>
        <button
          type="button" className="pagebtn" disabled={(page.page || 1) >= (page.totalPages || 1)}
          onClick={() => setFilters({ ...filters, page: (filters.page || 1) + 1 })}
        >
          Next
        </button>
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
      <TicketListPage />
    </Suspense>
  );
}
