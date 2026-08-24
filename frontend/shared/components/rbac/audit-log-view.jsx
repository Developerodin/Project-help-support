'use client';

import { useCallback, useEffect, useState } from 'react';
import AppLoader from '@/shared/components/app-loader.jsx';
import { listAuditLog } from '@/shared/api/rbac.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import {
  AUDIT_CATEGORY_LABELS,
  formatAuditAction,
  formatAuditActor,
  formatAuditTimestamp,
  summariseAuditDetails,
} from '@/shared/lib/rbac/audit-log-format.js';

const CATEGORY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'policy', label: AUDIT_CATEGORY_LABELS.policy },
  { value: 'access', label: AUDIT_CATEGORY_LABELS.access },
];

export default function AuditLogView({ limit = 50 }) {
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [rows, setRows] = useState([]);
  const [category, setCategory] = useState('');
  const [pageCount, setPageCount] = useState(1);
  const [meta, setMeta] = useState({ totalPages: 1, totalResults: 0 });
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  const loadAuditLog = useCallback(async (pages = 1, { append = false } = {}) => {
    if (append) setIsFetchingMore(true);
    else setLoadState('loading');
    setLoadError(null);
    try {
      const data = await listAuditLog({ limit, page: pages, category: category || undefined });
      const results = data.results || [];
      setRows((prev) => (append ? [...prev, ...results] : results));
      setPageCount(data.page || pages);
      setMeta({ totalPages: data.totalPages || 1, totalResults: data.totalResults || 0 });
      setLoadState(append || results.length ? 'data' : 'empty');
    } catch (err) {
      setLoadError(normalizeApiError(err));
      if (!append) setLoadState('error');
    } finally {
      setIsFetchingMore(false);
    }
  }, [limit, category]);

  useEffect(() => {
    loadAuditLog(1);
  }, [loadAuditLog]);

  const now = Date.now();

  const toolbar = (
    <div className="rbac-audit-toolbar">
      <div className="rbac-audit-filters" role="group" aria-label="Filter audit entries by category">
        {CATEGORY_FILTERS.map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            className={`chip${category === option.value ? ' chip-on' : ''}`}
            aria-pressed={category === option.value}
            onClick={() => setCategory(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="spacer" />
      {loadState === 'data' && (
        <span className="meta num" aria-live="polite">
          {rows.length} of {meta.totalResults}
        </span>
      )}
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => loadAuditLog(1)}
        disabled={loadState === 'loading'}
      >
        Refresh
      </button>
    </div>
  );

  let body;
  if (loadState === 'loading') {
    body = <AppLoader inline label="Loading audit log…" ariaLabel="Loading audit log" />;
  } else if (loadState === 'error') {
    body = (
      <div className="banner" role="alert">
        <b>Could not load audit log</b>
        <div>{loadError?.message || 'Check your connection and try again.'}</div>
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={() => loadAuditLog(1)}>Retry</button>
      </div>
    );
  } else if (loadState === 'empty') {
    body = (
      <div className="empty-state">
        <h3>{category ? `No ${AUDIT_CATEGORY_LABELS[category].toLowerCase()} entries yet` : 'No audit entries yet'}</h3>
        <p>Policy and access mutations will appear here.</p>
        {category && (
          <button type="button" className="btn btn-sm" onClick={() => setCategory('')}>
            Show all entries
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <>
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
                    <td>{formatAuditActor(row.actor)}</td>
                    <td>{formatAuditActor(row.targetUser)}</td>
                    <td className="rbac-audit-summary">{summariseAuditDetails(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pageCount < meta.totalPages && (
          <div className="rbac-audit-more">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => loadAuditLog(pageCount + 1, { append: true })}
              disabled={isFetchingMore}
            >
              {isFetchingMore ? 'Loading…' : `Load ${Math.min(limit, meta.totalResults - rows.length)} more`}
            </button>
            {loadError && <span className="meta">Could not load more — try again.</span>}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="rbac-audit">
      {toolbar}
      {body}
    </div>
  );
}
