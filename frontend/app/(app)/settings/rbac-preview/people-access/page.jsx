'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { isSuperAdmin } from '@pms/shared';
import AppLoader from '@/shared/components/app-loader.jsx';
import Icon, { initials } from '@/shared/components/icons.jsx';
import RbacPreviewNav from '@/shared/components/rbac-preview/preview-nav.jsx';
import AccessProfileDrawer from '@/shared/components/rbac-preview/access-profile-drawer.jsx';
import RoleBadges from '@/shared/components/role-badges.jsx';
import { usePreviewViewState } from '@/shared/lib/rbac-preview/preview-view-state.js';
import {
  countUserOverrides,
  filterEffectivelyActiveAssignments,
  getEffectivePermissions,
  getRoleBaselinePermissions,
} from '@/shared/lib/rbac-preview/matrix-utils.js';
import { listUsers } from '@/shared/api/users.js';
import { listClients } from '@/shared/api/clients.js';
import { listProjects } from '@/shared/api/projects.js';
import {
  getRoleMatrix,
  getUserPermissionOverrides,
  listUserScopedAssignments,
  updateUserPermissionOverrides,
  createUserScopedAssignment,
  revokeScopedAssignment,
} from '@/shared/api/rbac.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';
import { commitAccessMutation } from '@/shared/lib/rbac-preview/people-access-mutations.js';

export default function RbacPeopleAccessPreviewPage() {
  const { user: currentUser } = useAuth();
  const { viewMode: demoViewMode, retry: retryDemo } = usePreviewViewState();
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [users, setUsers] = useState([]);
  const [showSuperAdmins, setShowSuperAdmins] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userOverrides, setUserOverrides] = useState({});
  const [permissionSummaries, setPermissionSummaries] = useState({});
  const [roleMatrixRecord, setRoleMatrixRecord] = useState(null);
  const [assignmentCounts, setAssignmentCounts] = useState({});
  const [drawerAssignments, setDrawerAssignments] = useState([]);
  const [drawerOverrides, setDrawerOverrides] = useState({});
  const [drawerPermissionSummary, setDrawerPermissionSummary] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [overrideSaveBusy, setOverrideSaveBusy] = useState(false);
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantError, setGrantError] = useState(null);
  const [revokeBusyId, setRevokeBusyId] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');

  const canShowSuperAdmins = isSuperAdmin(currentUser);

  const loadUsers = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const params = { limit: 100 };
      if (showSuperAdmins && canShowSuperAdmins) params.includeSuperAdmins = true;
      const [page, matrixData, clientPage, projectPage] = await Promise.all([
        listUsers(params),
        getRoleMatrix(),
        listClients({ limit: 100 }),
        listProjects({ limit: 200 }),
      ]);
      setUsers(page.results || []);
      setRoleMatrixRecord(matrixData.effective || null);
      setClients(clientPage.results || []);
      setProjects(projectPage.results || []);
      setLoadState(page.results?.length ? 'data' : 'empty');
    } catch (err) {
      setLoadError(normalizeApiError(err));
      setLoadState('error');
    }
  }, [showSuperAdmins, canShowSuperAdmins]);

  useEffect(() => {
    if (demoViewMode === 'data') loadUsers();
  }, [demoViewMode, loadUsers]);

  const viewMode = demoViewMode !== 'data' ? demoViewMode : loadState;
  const retry = demoViewMode !== 'data' ? retryDemo : loadUsers;

  const visibleUsers = useMemo(() => {
    if (showSuperAdmins && canShowSuperAdmins) return users;
    return users.filter((user) => !isSuperAdmin(user));
  }, [users, showSuperAdmins, canShowSuperAdmins]);

  const handleOverrideChange = useCallback(async (permission, nextState) => {
    if (!selectedUser) return;
    const userId = selectedUser.id;
    const previous = { ...(drawerOverrides || {}) };
    const nextOverrides = { ...previous };
    if (!nextState) delete nextOverrides[permission];
    else nextOverrides[permission] = nextState;

    setDrawerOverrides(nextOverrides);
    setOverrideSaveBusy(true);
    try {
      const result = await updateUserPermissionOverrides(userId, { overrides: nextOverrides });
      setDrawerOverrides(result.overrides || {});
      setDrawerPermissionSummary({
        baseline: result.baseline || [],
        effective: result.effective || [],
      });
      setPermissionSummaries((current) => ({
        ...current,
        [userId]: {
          baseline: result.baseline || [],
          effective: result.effective || [],
        },
      }));
      setUserOverrides((current) => {
        const merged = { ...current };
        if (Object.keys(result.overrides || {}).length === 0) delete merged[userId];
        else merged[userId] = result.overrides;
        return merged;
      });
    } catch (err) {
      setDrawerOverrides(previous);
      showToast(normalizeApiError(err).message, { type: 'error' });
    } finally {
      setOverrideSaveBusy(false);
    }
  }, [selectedUser, drawerOverrides]);

  async function openAccessProfile(user) {
    setSelectedUser(user);
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerAssignments([]);
    setDrawerOverrides({});
    setDrawerPermissionSummary(null);

    try {
      const [overrideData, assignmentData] = await Promise.all([
        getUserPermissionOverrides(user.id),
        listUserScopedAssignments(user.id),
      ]);
      setDrawerOverrides(overrideData.overrides || {});
      setDrawerPermissionSummary({
        baseline: overrideData.baseline || [],
        effective: overrideData.effective || [],
      });
      const activeAssignments = filterEffectivelyActiveAssignments(assignmentData.assignments || []);
      setDrawerAssignments(activeAssignments);
      setUserOverrides((current) => ({
        ...current,
        [user.id]: overrideData.overrides || {},
      }));
      setPermissionSummaries((current) => ({
        ...current,
        [user.id]: {
          baseline: overrideData.baseline || [],
          effective: overrideData.effective || [],
        },
      }));
      setAssignmentCounts((current) => ({
        ...current,
        [user.id]: activeAssignments.length,
      }));
    } catch (err) {
      showToast(normalizeApiError(err).message, { type: 'error' });
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeAccessProfile() {
    setDrawerOpen(false);
    setSelectedUser(null);
    setDrawerAssignments([]);
    setDrawerOverrides({});
    setDrawerPermissionSummary(null);
    setGrantOpen(false);
    setGrantError(null);
    setRevokeTarget(null);
    setRevokeReason('');
  }

  async function refreshDrawerAssignments(userId) {
    const assignmentData = await listUserScopedAssignments(userId);
    const activeAssignments = filterEffectivelyActiveAssignments(assignmentData.assignments || []);
    setDrawerAssignments(activeAssignments);
    setAssignmentCounts((current) => ({
      ...current,
      [userId]: activeAssignments.length,
    }));
    return activeAssignments;
  }

  async function handleGrantConfirm(body) {
    if (!selectedUser) return;
    setGrantBusy(true);
    setGrantError(null);
    try {
      await commitAccessMutation({
        commit: () => createUserScopedAssignment(selectedUser.id, body),
        refresh: () => refreshDrawerAssignments(selectedUser.id),
        onRefreshFailure: (err) => {
          showToast(
            `Access granted, but the assignment list could not refresh. ${normalizeApiError(err).message}`,
          );
        },
      });
      setGrantOpen(false);
      showToast('Access granted');
    } catch (err) {
      setGrantError(err);
    } finally {
      setGrantBusy(false);
    }
  }

  async function handleRevokeConfirm() {
    if (!selectedUser || !revokeTarget || !revokeReason.trim()) return;
    setRevokeBusyId(revokeTarget.id);
    try {
      await commitAccessMutation({
        commit: () => revokeScopedAssignment(revokeTarget.id, {
          reason: revokeReason.trim(),
          ifMatch: revokeTarget.updatedAt,
        }),
        refresh: () => refreshDrawerAssignments(selectedUser.id),
        onRefreshFailure: (err) => {
          showToast(
            `Access revoked, but the assignment list could not refresh. ${normalizeApiError(err).message}`,
          );
        },
      });
      setRevokeTarget(null);
      setRevokeReason('');
      showToast('Access revoked');
    } catch (err) {
      showToast(normalizeApiError(err).message, { type: 'error' });
    } finally {
      setRevokeBusyId(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People &amp; overrides</h1>
          <p className="sub">
            Per-person permission overrides and scoped assignments.
            Role baselines are edited on the
            {' '}
            <Link href="/settings/rbac-preview/matrix">role matrix</Link>
            .
          </p>
        </div>
      </div>

      <RbacPreviewNav />

      {viewMode === 'data' && canShowSuperAdmins && (
        <div className="rbac-people-filters">
          <label className="rbac-preview-toggle">
            <input
              type="checkbox"
              checked={showSuperAdmins}
              onChange={(event) => setShowSuperAdmins(event.target.checked)}
            />
            Show Super Admin accounts
          </label>
        </div>
      )}

      {viewMode === 'loading' && (
        <AppLoader inline label="Loading people…" ariaLabel="Loading people and assignments" />
      )}

      {viewMode === 'empty' && (
        <div className="empty-state">
          <h3>No people yet</h3>
          <p>Invite someone to assign roles and scoped access.</p>
        </div>
      )}

      {viewMode === 'error' && (
        <div className="banner" role="alert">
          <Icon name="alert" size={16} aria-hidden="true" />
          <div>
            <b>Could not load people</b>
            <div>{loadError?.message || 'The users list failed to load. Check your connection and try again.'}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={retry}>
            Retry
          </button>
        </div>
      )}

      {viewMode === 'data' && (
        <div
          className="tablewrap rbac-people-table"
          tabIndex={0}
          aria-label="People and permission overrides"
        >
          <table>
            <caption className="sr-only">
              People with global roles, permission overrides, effective grants, and scoped assignments
            </caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Email</th>
                <th scope="col">Global roles</th>
                <th scope="col">Overrides</th>
                <th scope="col">Effective grants</th>
                <th scope="col">Scoped grants</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => {
                const grantCount = assignmentCounts[user.id];
                const overrideCount = countUserOverrides(userOverrides, user.id);
                const summary = permissionSummaries[user.id];
                const effectiveCount = summary
                  ? summary.effective.length
                  : getEffectivePermissions(user, {
                    roleMatrix: roleMatrixRecord,
                    userOverrides: userOverrides[user.id] || {},
                  }).size;
                const baselineCount = summary
                  ? summary.baseline.length
                  : getRoleBaselinePermissions(user, roleMatrixRecord).size;
                const displayName = user.name || user.email;
                return (
                  <tr key={user.id}>
                    <th scope="row">
                      <span className="personcell">
                        <span className="avatar sm">{initials(displayName)}</span>
                        <span>{displayName}</span>
                      </span>
                    </th>
                    <td>{user.email}</td>
                    <td>
                      <RoleBadges user={user} />
                    </td>
                    <td>
                      {overrideCount > 0 ? (
                        <span className="chip chip-sm chip--accent">
                          {overrideCount}
                          {' '}
                          override
                          {overrideCount === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="rbac-people-muted">None</span>
                      )}
                    </td>
                    <td>
                      <span className="rbac-people-effective" title={`${baselineCount} from roles`}>
                        {effectiveCount}
                      </span>
                    </td>
                    <td>
                      <span className="rbac-people-muted">
                        {grantCount == null ? '—' : (
                          <>
                            {grantCount}
                            {' '}
                            grant
                            {grantCount === 1 ? '' : 's'}
                          </>
                        )}
                      </span>
                    </td>
                    <td><span className="chip">{user.status}</span></td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => openAccessProfile(user)}
                      >
                        View access
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AccessProfileDrawer
        open={drawerOpen}
        user={selectedUser}
        assignments={drawerAssignments}
        overrides={drawerOverrides}
        permissionSummary={drawerPermissionSummary}
        roleMatrixRecord={roleMatrixRecord}
        clients={clients}
        projects={projects}
        loading={drawerLoading}
        overrideSaveBusy={overrideSaveBusy}
        grantBusy={grantBusy}
        grantError={grantError}
        grantOpen={grantOpen}
        revokeBusyId={revokeBusyId}
        onOverrideChange={handleOverrideChange}
        onGrantOpen={() => {
          setGrantError(null);
          setGrantOpen(true);
        }}
        onGrantConfirm={handleGrantConfirm}
        onGrantCancel={() => {
          if (!grantBusy) {
            setGrantOpen(false);
            setGrantError(null);
          }
        }}
        onRevoke={(row) => {
          setRevokeTarget(row);
          setRevokeReason('');
        }}
        onClose={closeAccessProfile}
      />

      {revokeTarget && (
        <div
          className="dscrim on"
          role="presentation"
          onClick={() => {
            if (!revokeBusyId) {
              setRevokeTarget(null);
              setRevokeReason('');
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="dlg grant-access-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dlg-head">
              <h3>Revoke access</h3>
              <p>A reason is required and is stored in the audit log.</p>
            </div>
            <div className="dlg-body">
              <div className="form-row">
                <label htmlFor="revoke-reason">Reason</label>
                <textarea
                  id="revoke-reason"
                  rows={3}
                  value={revokeReason}
                  disabled={Boolean(revokeBusyId)}
                  onChange={(event) => setRevokeReason(event.target.value)}
                />
              </div>
            </div>
            <div className="dlg-foot">
              <button
                type="button"
                className="btn"
                disabled={Boolean(revokeBusyId)}
                onClick={() => {
                  setRevokeTarget(null);
                  setRevokeReason('');
                }}
              >
                Cancel
              </button>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-danger"
                disabled={Boolean(revokeBusyId) || !revokeReason.trim()}
                onClick={handleRevokeConfirm}
              >
                {revokeBusyId ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
