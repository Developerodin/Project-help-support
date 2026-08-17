'use client';

import { useEffect, useState } from 'react';
import { listUsers } from '@/shared/api/users.js';
import { ROLE_IDS } from '@pms/shared';
import ExternalUserMultiSelect from '@/shared/components/external-user-multi-select.jsx';

export default function CompanyExternalAccessFields({
  clientUserIds,
  clientTesterIds,
  onClientUserIdsChange,
  onClientTesterIdsChange,
  disabled = false,
}) {
  const [clientUsers, setClientUsers] = useState([]);
  const [clientTesters, setClientTesters] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listUsers({ role: ROLE_IDS.CLIENT, status: 'active', limit: 100 }),
      listUsers({ role: ROLE_IDS.CLIENT_TESTER, status: 'active', limit: 100 }),
    ])
      .then(([clientsPage, testersPage]) => {
        if (cancelled) return;
        setClientUsers(clientsPage.results || []);
        setClientTesters(testersPage.results || []);
      })
      .catch(() => {
        if (!cancelled) {
          setClientUsers([]);
          setClientTesters([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="company-external-access">
      <h4 className="form-section">External access</h4>
      <p className="form-hint company-external-access__intro">
        Manage which external users can access this company and its projects.
      </p>
      <p className="company-external-access__scope">Company-wide access</p>

      <ExternalUserMultiSelect
        label="Client users"
        users={clientUsers}
        selectedIds={clientUserIds}
        onChange={onClientUserIdsChange}
        disabled={disabled}
        loading={loading}
        emptyMessage="No client users available. Invite users from People."
      />

      <ExternalUserMultiSelect
        label="Client testers"
        users={clientTesters}
        selectedIds={clientTesterIds}
        onChange={onClientTesterIdsChange}
        disabled={disabled}
        loading={loading}
        emptyMessage="No client testers available. Invite users from People."
      />
    </div>
  );
}
