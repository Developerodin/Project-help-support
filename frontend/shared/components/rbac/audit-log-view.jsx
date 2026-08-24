'use client';

import { useCallback, useEffect, useState } from 'react';
import AppLoader from '@/shared/components/app-loader.jsx';
import { listAuditLog } from '@/shared/api/rbac.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { formatAuditActor, summariseAuditDetails } from '@/shared/lib/rbac/audit-log-format.js';

export default function AuditLogView({ limit = 50 }) {
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [rows, setRows] = useState([]);
  const [pageMeta, setPageMeta] = useState({ page: 1, totalPages: 1, totalResults: 0 });

  const loadAuditLog = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const data = await listAuditLog({ limit });
      setRows(data.results || []);
      setPageMeta({
        page: data.page || 1,
        totalPages: data.totalPages || 1,
        totalResults: data.totalResults || 0,
      });
      setLoadState(data.results?.length ? 'data' : 'empty');
    } catch (err) {
      setLoadError(normalizeApiError(err));
      setLoadState('error');
    }
  }, [limit]);

  useEffect(() => {
    loadAuditLog();
  }, [loadAuditLog]);

  if (loadState === 'loading') {
    return (
      <AppLoader inline label="Loading audit log…" ariaLabel="Loading audit log" />
    );
  }

  if (loadState === 'empty') {
    return (
      <div className="empty-state">
        <h3>No audit entries yet</h3>
        <p>Policy and access mutations will appear here.</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="banner" role="alert">
        <b>Could not load audit log</b>
        <div>{loadError?.message || 'Check your connection and try again.'}</div>
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={loadAuditLog}>Retry</button>
      </div>
    );
  }

  return (
    <div className="tablewrap rbac-audit-table" tabIndex={0} aria-label="RBAC audit log">
      <table>
        <caption className="sr-only">
          RBAC audit entries — {pageMeta.totalResults} total
        </caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Category</th>
            <th scope="col">Action</th>
            <th scope="col">Actor</th>
            <th scope="col">Target</th>
            <th scope="col">Summary</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}</td>
              <td><span className="chip chip-sm">{row.category}</span></td>
              <td>{row.action}</td>
              <td>{formatAuditActor(row.actor)}</td>
              <td>{formatAuditActor(row.targetUser)}</td>
              <td className="rbac-audit-summary">{summariseAuditDetails(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
