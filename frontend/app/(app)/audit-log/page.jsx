'use client';

import '../../rbac-access.css';
import AuditLogView from '@/shared/components/rbac/audit-log-view.jsx';

export default function AuditLogPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="sub">Append-only trail of role policy, scoped access, security events, actions taken from WhatsApp and every ticket change.</p>
        </div>
      </div>

      <AuditLogView showOutboxBanner />
    </>
  );
}
