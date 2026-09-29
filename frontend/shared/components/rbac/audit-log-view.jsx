'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AppLoader from '@/shared/components/app-loader.jsx';
import {
  exportAuditLogCsv,
  getAuditOutboxStats,
  listAuditLog,
} from '@/shared/api/rbac.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import {
  AUDIT_CATEGORY_LABELS,
  formatAuditAction,
  formatAuditActor,
  formatAuditActorWithInitiator,
  formatAuditTimestamp,
  summariseAuditDetails,
} from '@/shared/lib/rbac/audit-log-format.js';
import AuditUserFilter from '@/shared/components/rbac/audit-user-filter.jsx';

const CATEGORY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'policy', label: AUDIT_CATEGORY_LABELS.policy },
  { value: 'access', label: AUDIT_CATEGORY_LABELS.access },
  { value: 'security', label: AUDIT_CATEGORY_LABELS.security },
  { value: 'whatsapp', label: AUDIT_CATEGORY_LABELS.whatsapp },
];

const SORT_FILTERS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
];

function listParamsFromQuery(query) {
  return {
    limit: query.limit,
    page: query.page,
    category: query.category || undefined,
    action: query.action || undefined,
    targetUserId: query.targetUserId || undefined,
    actorId: query.actorId || undefined,
    sortBy: query.sortBy || undefined,
  };
}

function AuditActorCells({ row }) {
  const { actor, initiator } = formatAuditActorWithInitiator(row);
  if (!initiator) {
    return <td>{actor}</td>;
  }
  return (
    <td>
      <span>{actor}</span>
      <span className="meta rbac-audit-initiator">Initiator: {initiator}</span>
    </td>
  );
}

function AuditRowCards({ rows, now }) {
  return (
    <ul className="rbac-audit-cards" aria-label="RBAC audit log">
      {rows.map((row) => {
        const when = formatAuditTimestamp(row.createdAt, now);
        const { actor, initiator } = formatAuditActorWithInitiator(row);
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
                <dd>{actor}</dd>
              </div>
              {initiator && (
                <div>
                  <dt>Initiator</dt>
                  <dd>{initiator}</dd>
                </div>
              )}
              <div>
                <dt>Target</dt>
                <dd>{formatAuditActor(row.targetUser)}</dd>
              </div>
            </dl>
            <p className="rbac-audit-summary">{summariseAuditDetails(row)}</p>
          </li>
        );
      })}
    </ul>
  );
}

const DEFAULT_QUERY = {
  page: 1,
  limit: 50,
  category: '',
  action: '',
  targetUserId: '',
  actorId: '',
  sortBy: 'createdAt:desc',
};

export default function AuditLogView({
  query: controlledQuery,
  onQueryChange: controlledOnQueryChange,
  showOutboxBanner = false,
}) {
  const [localQuery, setLocalQuery] = useState(DEFAULT_QUERY);
  const query = controlledQuery ?? localQuery;
  const onQueryChange = controlledOnQueryChange ?? ((patch) => {
    setLocalQuery((prev) => {
      const resetPage = 'category' in patch || 'action' in patch || 'targetUserId' in patch
        || 'actorId' in patch || 'sortBy' in patch || 'limit' in patch;
      return { ...prev, ...patch, ...(resetPage ? { page: 1 } : {}) };
    });
  });
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [loadMoreError, setLoadMoreError] = useState(null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ totalPages: 1, totalResults: 0 });
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [outboxStats, setOutboxStats] = useState(null);
  const hasLoadedOnce = useRef(false);
  const [actionInput, setActionInput] = useState(query.action);

  useEffect(() => {
    setActionInput(query.action);
  }, [query.action]);

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
  }, [showOutboxBanner, rows.length]);

  const loadAuditLog = useCallback(async (page, { append = false } = {}) => {
    if (append) {
      setIsFetchingMore(true);
      setLoadMoreError(null);
    } else if (!hasLoadedOnce.current) {
      setLoadState('loading');
    }
    setLoadError(null);
    try {
      const data = await listAuditLog(listParamsFromQuery({ ...query, page }));
      const results = data.results || [];
      setRows((prev) => (append ? [...prev, ...results] : results));
      setMeta({ totalPages: data.totalPages || 1, totalResults: data.totalResults || 0 });
      setLoadState(hasLoadedOnce.current || results.length || data.totalResults
        ? 'data'
        : 'empty');
      hasLoadedOnce.current = true;
    } catch (err) {
      const normalized = normalizeApiError(err);
      if (append) {
        setLoadMoreError(normalized);
      } else {
        setLoadError(normalized);
        setLoadState('error');
      }
    } finally {
      setIsFetchingMore(false);
    }
  }, [query]);

  useEffect(() => {
    loadAuditLog(query.page, { append: query.page > 1 });
  }, [loadAuditLog]);

  const handleExport = async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      const csv = await exportAuditLogCsv(listParamsFromQuery(query));
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

  const listRefreshing = loadState === 'loading' && hasLoadedOnce.current;
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
          placeholder="e.g. role_matrix.update"
          value={actionInput}
          onChange={(e) => setActionInput(e.target.value)}
          onBlur={() => {
            if (actionInput !== query.action) onQueryChange({ action: actionInput });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onQueryChange({ action: actionInput });
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
        {(loadState === 'data' || listRefreshing) && (
          <span className="meta num" aria-live="polite">
            {rows.length} of {meta.totalResults}
          </span>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={handleExport}
          disabled={exportBusy || (loadState === 'loading' && !hasLoadedOnce.current)}
        >
          {exportBusy ? 'Exporting…' : 'Export CSV'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => loadAuditLog(1)}
          disabled={loadState === 'loading' && !hasLoadedOnce.current}
        >
          Refresh
        </button>
      </div>
    </div>
  );

  let body;
  if (loadState === 'loading' && !hasLoadedOnce.current) {
    body = <AppLoader inline label="Loading audit log…" ariaLabel="Loading audit log" />;
  } else if (loadState === 'error') {
    body = (
      <div className="banner" role="alert">
        <b>Could not load audit log</b>
        <div>{loadError?.message || 'Check your connection and try again.'}</div>
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={() => loadAuditLog(query.page)}>Retry</button>
      </div>
    );
  } else if (loadState === 'empty' && !listRefreshing) {
    body = (
      <div className="empty-state">
        <h3>{query.category ? `No ${(AUDIT_CATEGORY_LABELS[query.category] || query.category).toLowerCase()} entries yet` : 'No audit entries yet'}</h3>
        <p>Policy, access, security and WhatsApp actions will appear here.</p>
        {query.category && (
          <button type="button" className="btn btn-sm" onClick={() => onQueryChange({ category: '' })}>
            Show all entries
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <>
        {listRefreshing && (
          <p className="meta rbac-audit-refreshing" aria-live="polite">Updating…</p>
        )}
        <div className="tablewrap rbac-audit-table" tabIndex={0} aria-label="RBAC audit log">
          <table>
            <caption className="sr-only">
              RBAC audit entries — showing {rows.length} of {meta.totalResults}
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
              {rows.map((row) => {
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
                    <td>{formatAuditActor(row.targetUser)}</td>
                    <td className="rbac-audit-summary">{summariseAuditDetails(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <AuditRowCards rows={rows} now={now} />
        {query.page < meta.totalPages && (
          <div className="rbac-audit-more">
            {loadMoreError && (
              <div className="banner rbac-audit-more-error" role="alert">
                <b>Could not load more entries</b>
                <div>{loadMoreError.message || 'Try again.'}</div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => loadAuditLog(query.page + 1, { append: true })}
                  disabled={isFetchingMore}
                >
                  Retry
                </button>
              </div>
            )}
            {!loadMoreError && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onQueryChange({ page: query.page + 1 })}
                disabled={isFetchingMore}
              >
                {isFetchingMore ? 'Loading…' : `Load ${Math.min(query.limit, meta.totalResults - rows.length)} more`}
              </button>
            )}
          </div>
        )}
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
