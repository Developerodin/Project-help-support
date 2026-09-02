'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cycleTicketSort, hasTicketPreferenceChanges, defaultTicketPreferencesForUser } from '@pms/shared';
import { listTickets } from '@/shared/api/tickets.js';
import { getProject } from '@/shared/api/projects.js';
import { isAbortError } from '@/shared/api/client.js';
import { AUTHENTICATED, useAuth } from '@/shared/contexts/auth-context.jsx';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { useTicketPreferences } from '@/shared/contexts/ticket-preferences-context.jsx';
import { ticketFromSearch, withTicketParam, withoutTicketParam } from '@/shared/lib/deep-link.js';
import {
  buildTicketListQuery,
  clampTicketListPage,
  hasFilterParams,
  limitFromSearch,
  pageFromSearch,
  resolveViewFilters,
  staleProjectFilters,
  withFilterParams,
  withPageParam,
  DEFAULT_TICKET_PREFERENCES,
} from '@/shared/lib/ticket-list-query.js';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';
import TicketFilters from '@/shared/components/tickets/ticket-filters.jsx';
import TicketTable from '@/shared/components/tickets/ticket-table.jsx';
import TicketDetailDrawer from '@/shared/components/tickets/ticket-detail-drawer.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';

/** Long enough to swallow a burst of typing, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

function TicketListPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { status: authStatus, user } = useAuth();
  const { activeProjectId, loading: projectLoading } = useProject();
  const {
    ready,
    preferences,
    setFilters,
    setSort,
    reset,
  } = useTicketPreferences();

  const [listPage, setListPage] = useState({ results: [], totalResults: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  // null means "not resolved yet" — see the owner-filter effect below. It is
  // NOT the same as [], and collapsing the two is what let an invisible owner
  // filter survive.
  const [ownerOptions, setOwnerOptions] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  // The URL is the view: filters, page and the open ticket all live in it, so a
  // refresh, a shared link and the back button all land on the same screen.
  // Saved preferences are only the default a bare /tickets starts from.
  const search = searchParams.toString();
  const searchString = search ? `?${search}` : '';
  const page = pageFromSearch(searchString);
  const limit = limitFromSearch(searchString, preferences.limit);
  const openTicketId = ticketFromSearch(searchString);

  const roleDefaults = useMemo(() => defaultTicketPreferencesForUser(user), [user]);

  const viewFilters = useMemo(
    () => resolveViewFilters(searchString, ready ? preferences : roleDefaults),
    [searchString, ready, preferences, roleDefaults],
  );

  /**
   * One mechanism for every URL write on this page. The native history API is
   * what Next syncs useSearchParams from, so mixing it with router.replace
   * would give two sources of truth for the same address bar.
   */
  const writeSearch = useCallback((nextSearch, { push = false } = {}) => {
    const url = `${pathname}${nextSearch}`;
    if (push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, [pathname]);

  const setPage = useCallback((next) => {
    // Built from window.location.search rather than searchParams so a param
    // written since the last render (the drawer's ?ticket=) is never dropped.
    writeSearch(withPageParam(window.location.search, Math.max(1, next)));
  }, [writeSearch]);

  /** URL first so the view updates now; preferences follow as the new default. */
  const applyFilters = useCallback((nextFilters) => {
    // A narrowed result set almost never has the page you were on.
    writeSearch(withPageParam(withFilterParams(window.location.search, nextFilters), 1));
    setFilters(nextFilters);
  }, [writeSearch, setFilters]);

  const normalizedUrl = useRef(false);
  useEffect(() => {
    // A bare /tickets showing saved filters is a view the URL cannot describe,
    // so copying the address bar would share the wrong list. Write it out once.
    if (!ready || normalizedUrl.current) return;
    normalizedUrl.current = true;
    if (hasFilterParams(window.location.search)) return;
    const next = withFilterParams(window.location.search, preferences.filters);
    if (next !== window.location.search) writeSearch(next);
  }, [ready, preferences.filters, writeSearch]);

  useEffect(() => {
    // Until the project list resolves, activeProjectId is null for "loading",
    // not for "all projects" — answering [] here would clear a real filter.
    if (projectLoading) {
      setOwnerOptions(null);
      return undefined;
    }
    if (!activeProjectId) {
      setOwnerOptions([]);
      return undefined;
    }

    let cancelled = false;
    setOwnerOptions(null);
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
        // Unknown, not empty. Never clear a filter on a failed lookup.
        if (!cancelled) setOwnerOptions(null);
      });
    return () => { cancelled = true; };
  }, [projectLoading, activeProjectId]);

  const ownerIds = useMemo(
    () => (ownerOptions ? ownerOptions.map((owner) => owner.id) : null),
    [ownerOptions],
  );

  useEffect(() => {
    if (!ready) return;
    // A project-scoped filter value outlives the project it came from, and the
    // <select> silently renders "Any owner" for a value it has no option for.
    // Clear it rather than filter by something the user cannot see.
    const patch = staleProjectFilters(viewFilters, { ownerIds });
    if (patch) applyFilters({ ...viewFilters, ...patch });
  }, [ready, viewFilters, ownerIds, applyFilters]);

  const lastProjectId = useRef(undefined);
  useEffect(() => {
    if (projectLoading) return;
    // First resolved value is the page loading, not the user switching project.
    // Resetting here unconditionally is what threw away ?page= on every mount.
    if (lastProjectId.current === undefined) {
      lastProjectId.current = activeProjectId;
      return;
    }
    if (lastProjectId.current === activeProjectId) return;
    lastProjectId.current = activeProjectId;
    setPage(1);
  }, [projectLoading, activeProjectId, setPage]);

  // The input stays instant; only the request trails the typing.
  const debouncedSearchTerm = useDebouncedValue(viewFilters.q, SEARCH_DEBOUNCE_MS);

  // Keyed by value, not by object identity. Every keystroke hands us a fresh
  // preferences object, so an identity-keyed memo would produce a new query
  // object each time and refetch — debounced term or not.
  const queryKey = useMemo(() => JSON.stringify(buildTicketListQuery({
    preferences: { ...preferences, filters: viewFilters },
    projectId: activeProjectId,
    page,
    limitOverride: limit,
    qOverride: debouncedSearchTerm,
  })), [preferences, viewFilters, activeProjectId, page, limit, debouncedSearchTerm]);

  const queryFilters = useMemo(() => JSON.parse(queryKey), [queryKey]);

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

  // One fetch path for everything, including the drawer's onChanged, so a
  // superseded request is always the one that gets aborted.
  const reload = useCallback(() => setReloadNonce((nonce) => nonce + 1), []);

  useEffect(() => {
    if (initialPageLoading) return undefined;
    const controller = new AbortController();
    setLoading(true);
    listTickets(queryFilters, { signal: controller.signal })
      .then(applyListResponse)
      .catch((error) => {
        if (isAbortError(error) || controller.signal.aborted) return;
        showToast(normalizeApiError(error)?.message || 'Could not load tickets');
      })
      .finally(() => {
        // A superseded request must not clear the loading state of its successor.
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [applyListResponse, queryFilters, initialPageLoading, reloadNonce]);

  // The view we pushed the drawer on top of, or null when the drawer was
  // reached by deep link and has no entry of ours behind it.
  const drawerOpenedFrom = useRef(null);

  const open = (ticketId) => {
    drawerOpenedFrom.current = window.location.search;
    writeSearch(withTicketParam(window.location.search, ticketId), { push: true });
  };

  const close = () => {
    const openedFrom = drawerOpenedFrom.current;
    drawerOpenedFrom.current = null;
    const without = withoutTicketParam(window.location.search);

    // Back only when the list behind the drawer is still the list we pushed
    // from. If the page moved on underneath (the clamp does this), going back
    // would throw that away; and a deep-linked drawer has no entry of ours at
    // all, so back would leave the site entirely.
    if (openedFrom === without) {
      // Close and Back are the same motion, so the entry is consumed rather
      // than left behind for Back to walk into again.
      window.history.back();
      return;
    }
    writeSearch(without);
  };

  const handleSort = (column) => {
    setPage(1);
    setSort(cycleTicketSort(preferences.sort, column));
  };

  const handleReset = async () => {
    setResetBusy(true);
    try {
      await reset();
      // The URL outranks preferences, so a reset that only clears the stored
      // defaults would leave the old view on screen.
      writeSearch(withPageParam(
        withFilterParams(window.location.search, defaultTicketPreferencesForUser(user).filters), 1,
      ));
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
        filters={viewFilters}
        onChange={applyFilters}
        ownerOptions={ownerOptions ?? []}
        onReset={handleReset}
        resetBusy={resetBusy}
        showReset={hasTicketPreferenceChanges({ ...preferences, filters: viewFilters }, user)}
      />
      {preferencesHydrating && !initialPageLoading ? (
        <p className="meta">Applying saved ticket preferences…</p>
      ) : null}
      {initialPageLoading || (loading && listPage.results.length === 0) ? (
        <AppLoader inline label={"Loading tickets…"} />
      ) : (
        <TicketTable
          tickets={listPage.results}
          onOpen={open}
          sort={preferences.sort}
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
