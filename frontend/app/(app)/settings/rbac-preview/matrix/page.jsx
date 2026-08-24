'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EXTERNAL_ROLES,
  MATRIX_ROLES,
  ROLE_IDS,
  ROLE_LABELS,
  getUserRoles,
  countRoleGrants,
} from '@pms/shared';
import { listUsers } from '@/shared/api/users.js';
import { getRoleMatrix } from '@/shared/api/rbac.js';
import AppLoader from '@/shared/components/app-loader.jsx';
import Icon from '@/shared/components/icons.jsx';
import RbacPreviewNav from '@/shared/components/rbac-preview/preview-nav.jsx';
import { usePreviewViewState } from '@/shared/lib/rbac-preview/preview-view-state.js';
import { recordToMatrixSnapshot } from '@/shared/lib/rbac-preview/matrix-utils.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';

const SYSTEM_ROLES = new Set([ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN]);

async function loadRoleUserCounts() {
  const counts = Object.fromEntries(MATRIX_ROLES.map((role) => [role, 0]));
  for (let page = 1; page <= 10; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await listUsers({ page, limit: 100, includeSuperAdmins: true });
    for (const user of res.results || []) {
      for (const role of getUserRoles(user)) {
        if (counts[role] !== undefined) counts[role] += 1;
      }
    }
    if (page >= (res.totalPages || 1)) break;
  }
  return counts;
}

export default function RbacRoleListPage() {
  const { viewMode: demoViewMode, retry: retryDemo } = usePreviewViewState();
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [userCounts, setUserCounts] = useState({});

  const loadRoles = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const [matrix, counts] = await Promise.all([
        getRoleMatrix(),
        loadRoleUserCounts(),
      ]);
      setSnapshot(recordToMatrixSnapshot(matrix.effective));
      setUserCounts(counts);
      setLoadState('data');
    } catch (err) {
      setLoadError(normalizeApiError(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    if (demoViewMode === 'data') loadRoles();
  }, [demoViewMode, loadRoles]);

  const viewMode = demoViewMode !== 'data' ? demoViewMode : loadState;
  const retry = demoViewMode !== 'data' ? retryDemo : loadRoles;

  const rows = useMemo(() => MATRIX_ROLES.map((role, index) => ({
    role,
    index: index + 1,
    label: ROLE_LABELS[role] || role,
    grants: snapshot ? countRoleGrants(snapshot, role) : 0,
    users: userCounts[role] || 0,
    tier: EXTERNAL_ROLES.includes(role) ? 'External' : 'Internal',
    system: SYSTEM_ROLES.has(role),
  })), [snapshot, userCounts]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>User roles</h1>
          <p className="sub">
            Manage permissions role by role. Select a role to edit its feature and board access.
          </p>
        </div>
        <span className="spacer" />
        <span className="chip">{MATRIX_ROLES.length} roles</span>
      </div>

      <RbacPreviewNav />

      {viewMode === 'loading' && (
        <AppLoader inline label="Loading roles…" ariaLabel="Loading user roles" />
      )}

      {viewMode === 'error' && (
        <div className="banner" role="alert">
          <Icon name="alert" size={16} aria-hidden="true" />
          <div>
            <b>Could not load roles</b>
            <div>{loadError?.message || 'Permission registry unavailable.'}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={retry}>Retry</button>
        </div>
      )}

      {viewMode === 'data' && (
        <div className="tablewrap rbac-role-list-wrap">
          <table className="rbac-role-list">
            <thead>
              <tr>
                <th scope="col" className="rbac-role-list__num">#</th>
                <th scope="col">Role</th>
                <th scope="col">Tier</th>
                <th scope="col">Status</th>
                <th scope="col">Permissions</th>
                <th scope="col">Users</th>
                <th scope="col" className="rbac-role-list__actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.role}>
                  <td className="rbac-role-list__num">{row.index}</td>
                  <td>
                    <div className="rbac-role-list__identity">
                      <span className="rbac-role-list__avatar" aria-hidden="true">
                        {row.label.charAt(0)}
                      </span>
                      <div>
                        <strong>{row.label}</strong>
                        {row.system && <span className="chip chip-system">System</span>}
                      </div>
                    </div>
                  </td>
                  <td>{row.tier}</td>
                  <td><span className="chip chip-active">Active</span></td>
                  <td className="rbac-role-list__count">{row.grants}</td>
                  <td className="rbac-role-list__count">{row.users}</td>
                  <td className="rbac-role-list__actions">
                    <Link
                      href={`/settings/rbac-preview/matrix/${encodeURIComponent(row.role)}`}
                      className="btn btn-sm btn-primary"
                    >
                      <Icon name="sliders" size={13} />
                      Manage permissions
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
