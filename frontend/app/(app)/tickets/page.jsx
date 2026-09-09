'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cycleTicketSort, hasActiveTicketFilters, hasTicketPreferenceChanges, defaultTicketPreferencesForUser } from '@pms/shared';
import { listTickets } from '@/shared/api/tickets.js';
import { getProject } from '@/shared/api/projects.js';
import { listUsers } from '@/shared/api/users.js';
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
  filtersFromSearch,
  resolveViewFilters,
  resolveViewProject,
  resolveViewSort,
  projectFromSearch,
  staleProjectFilters,
  TICKET_PAGE_SIZES,
  windowedPageNumbers,
  withFilterParams,
  withLimitParam,
  withPageParam,
  withProjectParam,
  withSortParam,
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
const CATEGORY_CARD_DEFS = Object.freeze([
  { key: 'Bug', label: 'Bug' },
  { key: 'Improvement', label: 'Improvement' },
  { key: 'New Feature', label: 'New Feature' },
]);

function TicketListPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { status: authStatus, user } = useAuth();
  const { activeProjectId, loading: projectLoading, setActiveProjectId } = useProject();
  const {
    ready,
    preferences,
    setFilters,
    setSort,
    patchPreferences,
    reset,
  } = useTicketPreferences();

  const [listPage, setListPage] = useState({
    results: [],
    totalResults: 0,
    page: 1,
    totalPages: 1,
    categoryTotals: { Bug: 0, Improvement: 0, 'New Feature': 0 },
  });
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

  const viewSort = useMemo(
    () => resolveViewSort(searchString, ready ? preferences : roleDefaults),
    [searchString, ready, preferences, roleDefaults],
  );

  const viewProjectId = useMemo(
    () => resolveViewProject(searchString, activeProjectId),
    [searchString, activeProjectId],
  );

  const [searchInput, setSearchInput] = useState(viewFilters.q || '');
  useEffect(() => {
    setSearchInput(viewFilters.q || '');
  }, [viewFilters.q]);

  const debouncedSearchInput = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

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
    writeSearch(withPageParam(withFilterParams(window.location.search, nextFilters), 1));
    setFilters(nextFilters);
  }, [writeSearch, setFilters]);

  useEffect(() => {
    const currentQ = filtersFromSearch(window.location.search).q || '';
    if (debouncedSearchInput === currentQ) return;
    const nextFilters = { ...filtersFromSearch(window.location.search), q: debouncedSearchInput };
    writeSearch(withPageParam(withFilterParams(window.location.search, nextFilters), 1));
    setFilters(nextFilters);
  }, [debouncedSearchInput, writeSearch, setFilters]);

  const normalizedProjectUrl = useRef(false);
  useEffect(() => {
    if (!ready || normalizedProjectUrl.current || projectLoading) return;
    normalizedProjectUrl.current = true;
    if (new URLSearchParams(window.location.search).has('project')) return;
    const next = withProjectParam(window.location.search, activeProjectId);
    if (next !== window.location.search) writeSearch(next);
  }, [ready, activeProjectId, projectLoading, writeSearch]);

  const projectChangedFromUrl = useRef(false);
  const syncedProjectFromUrl = useRef(false);

  useEffect(() => {
    if (projectLoading || syncedProjectFromUrl.current) return;
    syncedProjectFromUrl.current = true;
    if (!new URLSearchParams(window.location.search).has('project')) return;
    const fromUrl = projectFromSearch(window.location.search);
    if (fromUrl === activeProjectId) return;
    projectChangedFromUrl.current = true;
    setActiveProjectId(fromUrl);
  }, [projectLoading, activeProjectId, setActiveProjectId]);

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
      let cancelled = false;
      setOwnerOptions(null);
      listUsers({ status: 'active', limit: 100 })
        .then((page) => {
          if (cancelled) return;
          setOwnerOptions(page.results.map((person) => ({
            id: String(person.id),
            name: person.name || 'Unknown',
          })));
        })
        .catch(() => {
          if (!cancelled) setOwnerOptions(null);
        });
      return () => { cancelled = true; };
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
    // All-projects owner options are capped; do not clear a filter the list may
    // simply have truncated.
    if (!activeProjectId) return;
    const patch = staleProjectFilters(viewFilters, { ownerIds });
    if (patch) applyFilters({ ...viewFilters, ...patch });
  }, [ready, activeProjectId, viewFilters, ownerIds, applyFilters]);

  const lastProjectId = useRef(undefined);
  useEffect(() => {
    if (projectLoading) return;
    if (lastProjectId.current === undefined) {
      lastProjectId.current = activeProjectId;
      return;
    }
    if (lastProjectId.current === activeProjectId) return;
    lastProjectId.current = activeProjectId;
    const preservePage = projectChangedFromUrl.current;
    projectChangedFromUrl.current = false;
    const nextPage = preservePage ? pageFromSearch(window.location.search) : 1;
    writeSearch(withPageParam(withProjectParam(window.location.search, activeProjectId), nextPage));
  }, [projectLoading, activeProjectId, writeSearch]);

  // Keyed by value, not by object identity. Every keystroke hands us a fresh
  // preferences object, so an identity-keyed memo would produce a new query
  // object each time and refetch — debounced term or not.
  const queryKey = useMemo(() => JSON.stringify(buildTicketListQuery({
    preferences: { ...preferences, filters: viewFilters, sort: viewSort },
    projectId: viewProjectId,
    page,
    limitOverride: limit,
    qOverride: debouncedSearchInput,
  })), [preferences, viewFilters, viewSort, viewProjectId, page, limit, debouncedSearchInput]);

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
    const nextSort = cycleTicketSort(viewSort, column);
    writeSearch(withPageParam(
      withSortParam(window.location.search, nextSort),
      1,
    ));
    setSort(nextSort);
  };

  const handleLimitChange = (event) => {
    const nextLimit = Number.parseInt(event.target.value, 10);
    if (!TICKET_PAGE_SIZES.includes(nextLimit)) return;
    writeSearch(withPageParam(
      withLimitParam(window.location.search, nextLimit),
      1,
    ));
    patchPreferences({ limit: nextLimit });
  };

  const pageNumbers = useMemo(
    () => windowedPageNumbers(page, listPage.totalPages || 1),
    [page, listPage.totalPages],
  );

  const tableBusy = loading && listPage.results.length > 0;
  const showEmptyState = !loading && listPage.results.length === 0;
  const filtersActive = hasActiveTicketFilters(viewFilters, roleDefaults.filters);
  const ticketInList = openTicketId
    && listPage.results.some((ticket) => ticket.ticketId === openTicketId);
  const showDeepLinkBanner = Boolean(openTicketId && !loading && !ticketInList);
  const categoryCounts = listPage.categoryTotals || { Bug: 0, Improvement: 0, 'New Feature': 0 };
  const showingFrom = listPage.totalResults === 0 ? 0 : ((page - 1) * limit) + 1;
  const showingTo = Math.min(page * limit, listPage.totalResults || 0);
  const categoryCards = CATEGORY_CARD_DEFS.map((card) => {
    const count = Number(categoryCounts[card.key]) || 0;
    return {
      ...card,
      count,
      zero: count === 0,
      ariaLabel: `${card.label}: ${count} tickets in funnel.`,
    };
  });

  const handleReset = async () => {
    setResetBusy(true);
    try {
      await reset();
      // The URL outranks preferences, so a reset that only clears the stored
      // defaults would leave the old view on screen.
      writeSearch(withPageParam(
        withProjectParam(
          withLimitParam(
            withSortParam(
              withFilterParams(window.location.search, defaultTicketPreferencesForUser(user).filters),
              defaultTicketPreferencesForUser(user).sort,
            ),
            defaultTicketPreferencesForUser(user).limit,
          ),
          activeProjectId,
        ),
        1,
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
      <div className="page-head tickets-page-head">
        <div>
          <h1>Tickets</h1>
        </div>
        {!initialPageLoading ? (
          <div
            className="tickets-category-grid tickets-category-grid--top"
            role="list"
            aria-label="Ticket category summary"
          >
            {categoryCards.map((card) => (
              <div
                key={card.key}
                role="listitem"
                className={`tickets-category-card${card.zero ? ' is-zero' : ''}`}
                aria-label={card.ariaLabel}
              >
                <span className="tickets-category-label">{card.label}</span>
                <span className="tickets-category-count num">{card.count}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <TicketFilters
        filters={viewFilters}
        onChange={applyFilters}
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        ownerOptions={ownerOptions ?? []}
        ownerScopeHint={!activeProjectId && ownerOptions?.length ? 'Any owner (all projects)' : null}
        onReset={handleReset}
        resetBusy={resetBusy}
        showReset={hasTicketPreferenceChanges(
          { ...preferences, filters: viewFilters, sort: viewSort, limit },
          user,
        )}
      />
      {showDeepLinkBanner ? (
        <p className="meta" role="status">
          {openTicketId} is not in the current list — it may be filtered out or on another page. The detail drawer still opens below.
        </p>
      ) : null}
      {preferencesHydrating && !initialPageLoading ? (
        <p className="meta">Applying saved ticket preferences…</p>
      ) : null}
      {initialPageLoading || (loading && listPage.results.length === 0) ? (
        <AppLoader inline label={"Loading tickets…"} />
      ) : showEmptyState ? (
        <div className="empty-state">
          <h3>{filtersActive ? 'No ticket matches those filters' : 'No tickets yet'}</h3>
          <p>
            {filtersActive
              ? 'Try clearing filters or widening the search.'
              : 'Tickets filed for this project will show up here.'}
          </p>
          {filtersActive ? (
            <button type="button" className="btn btn-sm" onClick={handleReset} disabled={resetBusy}>
              Reset filters
            </button>
          ) : null}
        </div>
      ) : (
        <TicketTable
          tickets={listPage.results}
          onOpen={open}
          sort={viewSort}
          onSort={handleSort}
          busy={tableBusy}
        />
      )}

      <nav className="pager" aria-label="Ticket list pagination">
        <div className="pager__meta" aria-live="polite" aria-atomic="true">
          <span className="of">{listPage.totalResults} tickets</span>
          <span className="of">Showing {showingFrom}-{showingTo}</span>
          {(listPage.totalPages || 1) > 1 ? <span className="of">Page {page} of {listPage.totalPages}</span> : null}
        </div>

        <div className="pager__controls">
          <label className="pagesize">
            <span className="pagesize__label">Rows</span>
            <select
              aria-label="Rows per page"
              value={limit}
              disabled={loading}
              onChange={handleLimitChange}
            >
              {TICKET_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>{size} / page</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="pagebtn"
            aria-label="Previous page"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Prev
          </button>

          <div className="pager__pages" role="group" aria-label="Page numbers">
            {pageNumbers.map((item, index) => (
              typeof item === 'number' ? (
                <button
                  key={item}
                  type="button"
                  className="pagebtn"
                  aria-label={`Page ${item}`}
                  aria-current={item === page ? 'page' : undefined}
                  disabled={loading}
                  onClick={() => setPage(item)}
                >
                  {item}
                </button>
              ) : (
                <span key={`gap-${index}-${item}`} className="of pager__gap" aria-hidden="true">{item}</span>
              )
            ))}
          </div>

          <button
            type="button"
            className="pagebtn"
            aria-label="Next page"
            disabled={page >= (listPage.totalPages || 1) || loading}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </nav>

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
