'use client';

import RbacPreviewNav from '@/shared/components/rbac-preview/preview-nav.jsx';
import AuditLogView from '@/shared/components/rbac/audit-log-view.jsx';
import { usePreviewViewState } from '@/shared/lib/rbac-preview/preview-view-state.js';
import AppLoader from '@/shared/components/app-loader.jsx';

export default function RbacAuditLogPreviewPage() {
  const { viewMode: demoViewMode, retry: retryDemo } = usePreviewViewState();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="sub">Append-only trail of RBAC policy and scoped access changes.</p>
        </div>
      </div>

      <RbacPreviewNav />

      {demoViewMode === 'loading' && (
        <AppLoader inline label="Loading audit log…" ariaLabel="Loading audit log" />
      )}

      {demoViewMode === 'empty' && (
        <div className="empty-state">
          <h3>No audit entries yet</h3>
          <p>Policy and access mutations will appear here.</p>
        </div>
      )}

      {demoViewMode === 'error' && (
        <div className="banner" role="alert">
          <b>Could not load audit log</b>
          <div>Unable to load the audit log. Try again.</div>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={retryDemo}>Retry</button>
        </div>
      )}

      {demoViewMode === 'data' && <AuditLogView />}
    </>
  );
}
