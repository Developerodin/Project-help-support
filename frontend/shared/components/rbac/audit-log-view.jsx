'use client';

import {
  Suspense, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { usePathname } from 'next/navigation';
import AppLoader from '@/shared/components/app-loader.jsx';
import {
  exportAuditLogCsv,
  getAuditOutboxStats,
  listAuditLog,
} from '@/shared/api/rbac.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { useHistorySearch } from '@/shared/lib/use-history-search.js';
import { windowedPageNumbers } from '@/shared/lib/ticket-list-query.js';
import {
  AUDIT_CATEGORY_LABELS,
  formatAuditAction,
  formatAuditActorWithInitiator,
  formatAuditTarget,
  formatAuditTimestamp,
  summariseAuditDetails,
} from '@/shared/lib/rbac/audit-log-format.js';
import {
  AUDIT_PAGE_SIZES,
  CLEARED_AUDIT_FILTERS,
  auditListParams,
  auditQueryFromSearch,
  hasActiveAuditFilters,
  withAuditQuery,
} from '@/shared/lib/rbac/audit-log-query.js';
import AuditUserFilter from '@/shared/components/rbac/audit-user-filter.jsx';

const CATEGORY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'policy', label: AUDIT_CATEGORY_LABELS.policy },
  { value: 'access', label: AUDIT_CATEGORY_LABELS.access },
  { value: 'security', label: AUDIT_CATEGORY_LABELS.security },
  { value: 'whatsapp', label: AUDIT_CATEGORY_LABELS.whatsapp },
  { value: 'ticket', label: AUDIT_CATEGORY_LABELS.ticket },
];

const SORT_FILTERS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
];

const EMPTY_RESULT = {
  rows: [], category: '', page: 1, limit: 0, totalPages: 1, totalResults: 0,
};

function AuditActorCells({ row }) {
  const { actor, actorDetail, initiator } = formatAuditActorWithInitiator(row);
  if (!initiator && !actorDetail) {
    return <td>{actor}</td>;
  }
  return (
    <td>
      <span>{actor}</span>
      {actorDetail && <span className="meta rbac-audit-initiator">{actorDetail}</span>}
      {initiator && <span className="meta rbac-audit-initiator">Initiator: {initiator}</span>}
    </td>
  );
}

function AuditRowCards({ rows, now }) {
  return (
    <ul className="rbac-audit-cards" aria-label="RBAC audit log">
      {rows.map((row) => {
        const when = formatAuditTimestamp(row.createdAt, now);
        const { actor, actorDetail, initiator } = formatAuditActorWithInitiator(row);
        return (
          <li key={row.id} className="rbac-audit-card panel">
            <div className="rbac-audit-card__head">
              <time dateTime={when.iso} title={when.iso} className="rbac-audit-when">
                {when.absolute}
              </time>
              {when.relative && <span className="meta">{when.relative}</span>}
            </div>
            <div className="rbac-audit-card__action">
              <span
                className={`chip chip-sm rbac-audit-cat rbac-audit-cat--${row.category}`}
              >
                {AUDIT_CATEGORY_LABELS[row.category] || row.category}
              </span>
              <span title={row.action}>{formatAuditAction(row.action)}</span>
            </div>
            <dl className="rbac-audit-card__meta">
              <div>
                <dt>Actor</dt>
                <dd>
                  {actor}
                  {actorDetail && <span className="meta rbac-audit-initiator">{actorDetail}</span>}
                </dd>
              </div>
              {initiator && (
                <div>
                  <dt>Initiator</dt>
                  <dd>{initiator}</dd>
                </div>
              )}
              <div>
                <dt>Target</dt>
                <dd>{formatAuditTarget(row)}</dd>
              </div>
            </dl>
            <p className="rbac-audit-summary">{summariseAuditDetails(row)}</p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The URL is the view: category, action, actor, target, sort, page and page size all
 * live in it, so a refresh or the back button lands on the same filtered page.
 */
function AuditLogViewInner({ showOutboxBanner }) {
  const pathname = usePathname();
  const searchString = useHistorySearch();
  const query = useMemo(() => auditQueryFromSearch(searchString), [searchString]);
  const listKey = JSON.stringify(auditListParams(query));

  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [result, setResult] = useState(EMPTY_RESULT);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [outboxStats, setOutboxStats] = useState(null);
  const hasLoadedOnce = useRef(false);
  // A slow response for the previous filter must not overwrite the rows for the current one.
  const latestRequest = useRef(0);
  const [actionInput, setActionInput] = useState(query.action);

  useEffect(() => {
    setActionInput(query.action);
  }, [query.action]);

  /** Same mechanism as the other list pages, so Next keeps useSearchParams in sync. */
  const onQueryChange = useCallback((patch) => {
    window.history.replaceState(null, '', `${pathname}${withAuditQuery(window.location.search, patch)}`);
  }, [pathname]);

  useEffect(() => {
    if (!showOutboxBanner) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const stats = await getAuditOutboxStats();
        if (!cancelled) setOutboxStats(stats);
      } catch {
        if (!cancelled) setOutboxStats(null);
      }
    })();
    return () => { cancelled = true; };
  }, [showOutboxBanner, result.rows.length]);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    const params = JSON.parse(listKey);
    if (hasLoadedOnce.current) setIsRefreshing(true);
    else setLoadState('loading');
    setLoadError(null);

    (async () => {
      try {
        const data = await listAuditLog(params);
        if (requestId !== latestRequest.current) return;
        const totalPages = Math.max(1, data.totalPages || 1);
        if (params.page > totalPages) {
          // A page past the end (entries deleted, a stale link): land on the last real page.
          onQueryChange({ page: totalPages });
          return;
        }
        const rows = data.results || [];
        setResult({
          rows,
          category: params.category || '',
          page: params.page,
          limit: params.limit,
          totalPages,
          totalResults: data.totalResults || 0,
        });
        setLoadState(rows.length ? 'data' : 'empty');
        hasLoadedOnce.current = true;
        setIsRefreshing(false);
      } catch (err) {
        if (requestId !== latestRequest.current) return;
        setLoadError(normalizeApiError(err));
        setLoadState('error');
        setIsRefreshing(false);
      }
    })();
  }, [listKey, reloadNonce, onQueryChange]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  const handleExport = async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      const csv = await exportAuditLogCsv(auditListParams({ ...query, page: undefined, limit: undefined }));
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'rbac-audit-log.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(normalizeApiError(err));
    } finally {
      setExportBusy(false);
    }
  };

  const pageNumbers = useMemo(
    () => windowedPageNumbers(query.page, result.totalPages),
    [query.page, result.totalPages],
  );

  // Rows fetched for another category never paint under this tab, even while its request is in flight.
  const rowsMatchView = result.category === query.category;
  const filtersActive = hasActiveAuditFilters(query);
  const onlyCategory = query.category && !query.action && !query.actorId && !query.targetUserId;
  const categoryLabel = AUDIT_CATEGORY_LABELS[query.category] || query.category;
  const showingFrom = result.totalResults ? (result.page - 1) * result.limit + 1 : 0;
  const showingTo = Math.min(result.page * result.limit, result.totalResults);
  const initialLoading = loadState === 'loading' && !hasLoadedOnce.current;
  const now = Date.now();
  const outboxPending = outboxStats?.pending ?? 0;

  const toolbar = (
    <div className="rbac-audit-toolbar">
      <div className="rbac-audit-field rbac-audit-field--category">
        <span className="rbac-audit-field__label">Category</span>
        <div className="seg rbac-audit-filters" role="group" aria-label="Filter audit entries by category">
          {CATEGORY_FILTERS.map((option) => (
            <button
              key={option.value || 'all'}
              type="button"
              aria-pressed={query.category === option.value}
              onClick={() => onQueryChange({ category: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <label className="rbac-audit-field rbac-audit-field--action">
        <span className="rbac-audit-field__label">Action</span>
        <input
          type="search"
          className="rbac-audit-control"
          placeholder="e.g. role_matrix.update or WEB-12"
          value={actionInput}
          onChange={(e) => setActionInput(e.target.value)}
          onBlur={() => {
            if (actionInput.trim() !== query.action) onQueryChange({ action: actionInput.trim() });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onQueryChange({ action: actionInput.trim() });
          }}
        />
      </label>
      <AuditUserFilter
        label="Actor"
        value={query.actorId}
        onChange={(actorId) => onQueryChange({ actorId })}
      />
      <AuditUserFilter
        label="Target"
        value={query.targetUserId}
        onChange={(targetUserId) => onQueryChange({ targetUserId })}
      />
      <label className="rbac-audit-field rbac-audit-field--sort">
        <span className="rbac-audit-field__label">Sort</span>
        <select
          className="rbac-audit-control"
          value={query.sortBy}
          onChange={(e) => onQueryChange({ sortBy: e.target.value })}
        >
          {SORT_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
      <div className="rbac-audit-toolbar__actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={handleExport}
          disabled={exportBusy || initialLoading}
        >
          {exportBusy ? 'Exporting…' : 'Export CSV'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={reload}
          disabled={initialLoading}
        >
          Refresh
        </button>
      </div>
    </div>
  );

  let body;
  if (initialLoading) {
    body = <AppLoader inline label="Loading audit log…" ariaLabel="Loading audit log" />;
  } else if (loadState === 'error') {
    body = (
      <div className="banner" role="alert">
        <b>Could not load audit log</b>
        <div>{loadError?.message || 'Check your connection and try again.'}</div>
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={reload}>Retry</button>
      </div>
    );
  } else if (isRefreshing && (loadState !== 'data' || !rowsMatchView)) {
    body = <AppLoader inline label="Updating results…" ariaLabel="Updating audit log" />;
  } else if (loadState === 'empty') {
    let heading = 'No audit entries yet';
    let hint = 'Policy, access, security, WhatsApp and ticket actions will appear here.';
    if (onlyCategory) {
      heading = `No ${categoryLabel} entries yet`;
    } else if (filtersActive) {
      heading = 'No entries match these filters';
      hint = 'Try a different category, action, actor or target.';
    }
    body = (
      <div className="empty-state">
        <h3>{heading}</h3>
        <p>{hint}</p>
        {filtersActive && (
          <button type="button" className="btn btn-sm" onClick={() => onQueryChange(CLEARED_AUDIT_FILTERS)}>
            {onlyCategory ? 'Show all entries' : 'Clear filters'}
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <>
        {isRefreshing && (
          <p className="meta rbac-audit-refreshing">Updating results…</p>
        )}
        <div
          className="tablewrap rbac-audit-table"
          tabIndex={0}
          aria-label="RBAC audit log"
          aria-busy={isRefreshing || undefined}
        >
          <table>
            <caption className="sr-only">
              RBAC audit entries, showing {showingFrom} to {showingTo} of {result.totalResults}
            </caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">Actor</th>
                <th scope="col">Target</th>
                <th scope="col">What changed</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => {
                const when = formatAuditTimestamp(row.createdAt, now);
                return (
                  <tr key={row.id}>
                    <td className="rbac-audit-when">
                      <time dateTime={when.iso} title={when.iso}>{when.absolute}</time>
                      {when.relative && <span className="meta">{when.relative}</span>}
                    </td>
                    <td className="rbac-audit-action">
                      <span
                        className={`chip chip-sm rbac-audit-cat rbac-audit-cat--${row.category}`}
                      >
                        {AUDIT_CATEGORY_LABELS[row.category] || row.category}
                      </span>
                      <span title={row.action}>{formatAuditAction(row.action)}</span>
                    </td>
                    <AuditActorCells row={row} />
                    <td>{formatAuditTarget(row)}</td>
                    <td className="rbac-audit-summary">{summariseAuditDetails(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <AuditRowCards rows={result.rows} now={now} />
        <nav className="pager" aria-label="Audit log pagination">
          <div className="pager__meta" aria-live="polite" aria-atomic="true">
            {isRefreshing ? <span className="of">Updating results…</span> : null}
            <span className="of">{result.totalResults} {result.totalResults === 1 ? 'entry' : 'entries'}</span>
            <span className="of">Showing {showingFrom}-{showingTo}</span>
            {result.totalPages > 1 ? <span className="of">Page {query.page} of {result.totalPages}</span> : null}
          </div>

          <div className="pager__controls">
            <label className="pagesize">
              <span className="pagesize__label">Rows</span>
              <select
                aria-label="Rows per page"
                value={query.limit}
                disabled={isRefreshing}
                onChange={(e) => onQueryChange({ limit: Number.parseInt(e.target.value, 10) })}
              >
                {AUDIT_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size} / page</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="pagebtn"
              aria-label="Previous page"
              disabled={query.page <= 1 || isRefreshing}
              onClick={() => onQueryChange({ page: query.page - 1 })}
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
                    aria-current={item === query.page ? 'page' : undefined}
                    disabled={isRefreshing}
                    onClick={() => onQueryChange({ page: item })}
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
              disabled={query.page >= result.totalPages || isRefreshing}
              onClick={() => onQueryChange({ page: query.page + 1 })}
            >
              Next
            </button>
          </div>
        </nav>
      </>
    );
  }

  return (
    <div className="rbac-audit">
      {showOutboxBanner && outboxPending > 0 && (
        <div className="banner rbac-audit-outbox" role="status">
          <b>{outboxPending} audit event{outboxPending === 1 ? '' : 's'} pending retry</b>
          <div className="meta">
            Failed writes are queued in the audit outbox and replayed automatically. Failed count: {outboxStats?.failed ?? 0}.
          </div>
        </div>
      )}
      {exportError && (
        <div className="banner" role="alert">
          <b>Export failed</b>
          <div>{exportError.message}</div>
        </div>
      )}
      {toolbar}
      {body}
    </div>
  );
}

export default function AuditLogView({ showOutboxBanner = false }) {
  return (
    <Suspense fallback={<AppLoader inline label="Loading audit log…" ariaLabel="Loading audit log" />}>
      <AuditLogViewInner showOutboxBanner={showOutboxBanner} />
    </Suspense>
  );
}
