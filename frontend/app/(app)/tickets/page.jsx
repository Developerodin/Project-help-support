'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cycleTicketSort, hasTicketPreferenceChanges } from '@pms/shared';
import { listTickets } from '@/shared/api/tickets.js';
import { getProject } from '@/shared/api/projects.js';
import { AUTHENTICATED, useAuth } from '@/shared/contexts/auth-context.jsx';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { useTicketPreferences } from '@/shared/contexts/ticket-preferences-context.jsx';
import { ticketFromSearch, withTicketParam, withoutTicketParam } from '@/shared/lib/deep-link.js';
import {
  buildTicketListQuery,
  clampTicketListPage,
  DEFAULT_TICKET_PREFERENCES,
} from '@/shared/lib/ticket-list-query.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';
import TicketFilters from '@/shared/components/tickets/ticket-filters.jsx';
import TicketTable from '@/shared/components/tickets/ticket-table.jsx';
import TicketDetailDrawer from '@/shared/components/tickets/ticket-detail-drawer.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';

function TicketListPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { status: authStatus } = useAuth();
  const { activeProjectId, loading: projectLoading } = useProject();
  const {
    ready,
    preferences,
    page,
    setPage,
    setFilters,
    setSort,
    reset,
  } = useTicketPreferences();

  const [listPage, setListPage] = useState({ results: [], totalResults: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [ownerOptions, setOwnerOptions] = useState([]);
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    const search = searchParams.toString();
    setOpenTicketId(ticketFromSearch(search ? `?${search}` : ''));
  }, [searchParams]);

  useEffect(() => {
    if (!activeProjectId) {
      setOwnerOptions([]);
      return undefined;
    }
    let cancelled = false;
    getProject(activeProjectId)
      .then((project) => {
        if (cancelled) return;
        const members = (project.teamMembers || []).map((member) => ({
          id: String(member.user?.id || member.user?._id),
          name: member.user?.name || 'Unknown',
        }));
        setOwnerOptions(members);
      })
      .catch(() => {
        if (!cancelled) setOwnerOptions([]);
      });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  useEffect(() => {
    setPage(1);
  }, [activeProjectId, setPage]);

  const queryPreferences = useMemo(
    () => (ready ? preferences : DEFAULT_TICKET_PREFERENCES),
    [ready, preferences],
  );

  const queryFilters = useMemo(() => buildTicketListQuery({
    preferences: queryPreferences,
    projectId: activeProjectId,
    page,
  }), [queryPreferences, activeProjectId, page]);

  const initialPageLoading = authStatus !== AUTHENTICATED || projectLoading;
  const preferencesHydrating = !ready;

  const applyListResponse = useCallback((data) => {
    if (!data) return;
    const totalPages = data.totalPages || 1;
    const clampedPage = clampTicketListPage(page, totalPages);
    if (clampedPage !== page) {
      setPage(clampedPage);
      return;
    }
    setListPage(data);
  }, [page, setPage]);

  const reload = useCallback(() => {
    if (initialPageLoading) return;
    setLoading(true);
    listTickets(queryFilters)
      .then(applyListResponse)
      .finally(() => setLoading(false));
  }, [applyListResponse, queryFilters, initialPageLoading]);

  useEffect(() => {
    if (initialPageLoading) return undefined;
    let cancelled = false;
    setLoading(true);
    listTickets(queryFilters)
      .then((data) => {
        if (!cancelled) applyListResponse(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [applyListResponse, queryFilters, initialPageLoading]);

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

  const handleSort = (column) => {
    setSort(cycleTicketSort(queryPreferences.sort, column));
  };

  const handleReset = async () => {
    setResetBusy(true);
    try {
      await reset();
      showToast('Filters and sorting reset to default');
    } catch (err) {
      showToast(normalizeApiError(err)?.message || 'Could not reset filters');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tickets</h1>
          <p className="sub">Every ticket across Web App and Mobile App. Searching for a ticket number jumps straight to it.</p>
        </div>
      </div>

      <TicketFilters
        filters={queryPreferences.filters}
        onChange={setFilters}
        ownerOptions={ownerOptions}
        onReset={handleReset}
        resetBusy={resetBusy}
        showReset={hasTicketPreferenceChanges(queryPreferences)}
      />
      {preferencesHydrating && !initialPageLoading ? (
        <p className="meta">Applying saved ticket preferences…</p>
      ) : null}
      {initialPageLoading || (loading && listPage.results.length === 0) ? (
        <AppLoader inline label={"Loading tickets\u2026"} />
      ) : (
        <TicketTable
          tickets={listPage.results}
          onOpen={open}
          sort={queryPreferences.sort}
          onSort={handleSort}
        />
      )}

      <div className="pager">
        <span className="of">
          {listPage.totalResults} tickets
          {(listPage.totalPages || 1) > 1 && ` · page ${page} of ${listPage.totalPages}`}
        </span>
        <span className="spacer" />
        <button
          type="button" className="pagebtn" disabled={page <= 1 || loading}
          onClick={() => setPage(page - 1)}
        >
          Prev
        </button>
        <button
          type="button" className="pagebtn" disabled={page >= (listPage.totalPages || 1) || loading}
          onClick={() => setPage(page + 1)}
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
