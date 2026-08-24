'use client';

import '../../rbac-access.css';
import AuditLogView from '@/shared/components/rbac/audit-log-view.jsx';

export default function AuditLogPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="sub">Append-only trail of RBAC policy and scoped access changes.</p>
        </div>
      </div>

      <AuditLogView />
    </>
  );
}
