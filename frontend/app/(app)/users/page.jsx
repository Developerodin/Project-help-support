'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PEOPLE_ASSIGNABLE_ROLES,
  ROLE_IDS,
  ROLE_LABELS,
  EXTERNAL_ROLES,
  IMPERSONATION_INITIATOR_ROLES,
  getUserRoles,
  hasAnyRole,
  isSuperAdmin,
} from '@pms/shared';
import { listUsers, inviteUser, patchUser, resendInvite, deleteUser, reactivateUser } from '@/shared/api/users.js';
import { listClients } from '@/shared/api/clients.js';
import { listProjects } from '@/shared/api/projects.js';
import {
  createUserScopedAssignment,
  listUserScopedAssignments,
  revokeScopedAssignment,
} from '@/shared/api/rbac.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import InviteDialog from '@/shared/components/invite-dialog.jsx';
import AccessProfileDrawer from '@/shared/components/rbac-preview/access-profile-drawer.jsx';
import RoleMultiSelect from '@/shared/components/role-multi-select.jsx';
import Icon, { initials } from '@/shared/components/icons.jsx';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { getDefaultRedirect } from '@/shared/lib/route-permissions.js';
import { filterEffectivelyActiveAssignments } from '@/shared/lib/rbac-preview/matrix-utils.js';
import { commitAccessMutation } from '@/shared/lib/rbac-preview/people-access-mutations.js';
import { windowedPageNumbers } from '@/shared/lib/ticket-list-query.js';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value.js';
import { showToast } from '@/shared/lib/toast.js';
import { capRoles } from '@/shared/lib/profile-utils.js';
import '../../rbac-access.css';

const SCRUBBED_EMAIL = /^deleted\+[a-f0-9]{24}@internal$/i;
const PEOPLE_PAGE_SIZES = Object.freeze([25, 50, 100]);
const PEOPLE_FILTER_STATUSES = Object.freeze(['invited', 'active', 'inactive', 'deleted']);
const PEOPLE_FILTER_ROLES = Object.freeze([...PEOPLE_ASSIGNABLE_ROLES, ROLE_IDS.SUPER_ADMIN]);
const SEARCH_DEBOUNCE_MS = 300;

/** Soft-deleted, including legacy hard-delete scrub rows (deleted+...@internal). */
function accountDeleted(user) {
  if (!user) return false;
  if (user.status === 'deleted') return true;
  const email = typeof user.email === 'string' ? user.email : '';
  return SCRUBBED_EMAIL.test(email);
}

function canReactivateDeleted(user) {
  if (!accountDeleted(user)) return false;
  const email = typeof user.email === 'string' ? user.email : '';
  return !SCRUBBED_EMAIL.test(email);
}

function isExternalRoleSet(roles) {
  return roles.some((role) => EXTERNAL_ROLES.includes(role));
}

function rolesCrossAccessBoundary(fromRoles, toRoles) {
  const addedRoles = toRoles.filter((role) => !fromRoles.includes(role));
  const fromExternal = isExternalRoleSet(fromRoles);
  const addedExternal = addedRoles.some((role) => EXTERNAL_ROLES.includes(role));
  const addedInternal = addedRoles.some((role) => !EXTERNAL_ROLES.includes(role));
  if (!fromExternal && addedExternal) return true;
  if (fromExternal && addedInternal) return true;
  return false;
}

function formatRoleLabels(roles) {
  return roles.map((role) => ROLE_LABELS[role] || role).join(', ');
}

/** Backend rejects mixed internal/external roles — keep only the newly chosen side. */
function normalizeCrossBoundaryRoles(fromRoles, toRoles) {
  const addedRoles = toRoles.filter((role) => !fromRoles.includes(role));
  const fromExternal = isExternalRoleSet(fromRoles);
  const addedExternal = addedRoles.some((role) => EXTERNAL_ROLES.includes(role));
  const addedInternal = addedRoles.some((role) => !EXTERNAL_ROLES.includes(role));

  if (!fromExternal && addedExternal) {
    const externalOnly = toRoles.filter((role) => EXTERNAL_ROLES.includes(role));
    return externalOnly.length ? externalOnly : [ROLE_IDS.CLIENT];
  }
  if (fromExternal && addedInternal) {
    const internalOnly = toRoles.filter((role) => !EXTERNAL_ROLES.includes(role));
    return internalOnly.length ? internalOnly : [ROLE_IDS.UNASSIGNED];
  }
  return toRoles;
}

function ActionButton({
  label,
  icon,
  busyLabel,
  busy,
  success,
  error,
  onClick,
  danger = false,
}) {
  return (
    <span className="row-action">
      <button
        type="button"
        className={`btn btn-sm${danger ? ' btn-danger' : ''}${icon ? ' btn-icon' : ''}`}
        onClick={onClick}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={icon ? (busy ? (busyLabel || `${label}…`) : label) : undefined}
        title={icon ? label : undefined}
      >
        {busy ? (
          icon ? (
            <span className="btn-spin" aria-hidden="true" />
          ) : (
            <>
              <span className="btn-spin" aria-hidden="true" />
              {busyLabel || `${label}…`}
            </>
          )
        ) : (icon ? <Icon name={icon} size={14} /> : label)}
      </button>
      {(success || error) && (
        <span
          className={`row-action-status${error ? ' row-action-status--error' : ''}`}
          role="status"
          aria-live="polite"
        >
          {success || error}
        </span>
      )}
    </span>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const { user: currentUser, startImpersonation } = useAuth();
  const canImpersonate = hasAnyRole(currentUser, ...IMPERSONATION_INITIATOR_ROLES);
  const assignableRoles = PEOPLE_ASSIGNABLE_ROLES;
  const [users, setUsers] = useState([]);
  const [listPage, setListPage] = useState({
    totalResults: 0,
    totalPages: 1,
    page: 1,
    limit: PEOPLE_PAGE_SIZES[0],
  });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PEOPLE_PAGE_SIZES[0]);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [draft, setDraft] = useState({ email: '', roles: [ROLE_IDS.UNASSIGNED] });
  const [error, setError] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmRoleChange, setConfirmRoleChange] = useState(null);
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [roleChangeBusy, setRoleChangeBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState({});
  const [rowFeedback, setRowFeedback] = useState({});
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [scopeCatalogLoaded, setScopeCatalogLoaded] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerAssignments, setDrawerAssignments] = useState([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantError, setGrantError] = useState(null);
  const [revokeBusyId, setRevokeBusyId] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');
  const debouncedSearchInput = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  const reload = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const params = { page, limit, includeSuperAdmins: true };
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.status = statusFilter;
      if (debouncedSearchInput.trim()) params.q = debouncedSearchInput.trim();

      const nextPage = await listUsers(params);
      const totalPages = Math.max(1, Number(nextPage?.totalPages) || 1);
      if (page > totalPages) {
        setPage(totalPages);
        return;
      }

      setUsers(nextPage?.results || []);
      setListPage({
        totalResults: Number(nextPage?.totalResults) || 0,
        totalPages,
        page: Number(nextPage?.page) || page,
        limit: Number(nextPage?.limit) || limit,
      });
      setError(null);
    } catch (err) {
      setUsers([]);
      setError(err);
    } finally {
      setLoadingUsers(false);
    }
  }, [debouncedSearchInput, limit, page, roleFilter, statusFilter]);

  useEffect(() => { reload(); }, [reload]);

  const pageNumbers = useMemo(
    () => windowedPageNumbers(page, listPage.totalPages),
    [listPage.totalPages, page],
  );
  const showingFrom = listPage.totalResults === 0 ? 0 : ((page - 1) * limit) + 1;
  const showingTo = Math.min(page * limit, listPage.totalResults || 0);
  const listFiltersActive = Boolean(searchInput.trim() || roleFilter || statusFilter);

  function setRowActionBusy(key, value) {
    setRowBusy((prev) => {
      const next = { ...prev };
      if (value) next[key] = true;
      else delete next[key];
      return next;
    });
  }

  function setRowActionFeedback(key, feedback) {
    setRowFeedback((prev) => {
      const next = { ...prev };
      if (feedback) next[key] = feedback;
      else delete next[key];
      return next;
    });
  }

  function flashRowFeedback(key, feedback, durationMs = 2500) {
    setRowActionFeedback(key, feedback);
    window.setTimeout(() => setRowActionFeedback(key, null), durationMs);
  }

  async function invite() {
    setError(null);
    setInviteBusy(true);
    try {
      const to = draft.email.trim();
      await inviteUser({ ...draft, email: to });
      setDraft({ email: '', roles: [ROLE_IDS.UNASSIGNED] });
      setInviteOpen(false);
      showToast(`Invite sent to ${to}`);
      reload();
    } catch (err) {
      setError(err);
    } finally {
      setInviteBusy(false);
    }
  }

  function closeInvite() {
    if (inviteBusy) return;
    setInviteOpen(false);
    setError(null);
    setDraft({ email: '', roles: [ROLE_IDS.UNASSIGNED] });
  }

  async function patchRow(id, body, actionKey, successMessage) {
    setError(null);
    setRowActionBusy(actionKey, true);
    setRowActionFeedback(actionKey, null);
    try {
      await patchUser(id, body);
      if (successMessage) showToast(successMessage);
      reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Request failed';
      setRowActionFeedback(actionKey, { error: message });
      showToast(message);
    } finally {
      setRowActionBusy(actionKey, false);
    }
  }

  function requestRoleChange(user, newRoles) {
    const oldRoles = getUserRoles(user);
    if (rolesCrossAccessBoundary(oldRoles, newRoles)) {
      const targetRoles = normalizeCrossBoundaryRoles(oldRoles, newRoles);
      setConfirmRoleChange({
        user,
        oldRoles,
        newRoles: targetRoles,
        toExternal: isExternalRoleSet(targetRoles),
      });
      return;
    }
    patchRow(user.id, { roles: newRoles }, `${user.id}:role`);
  }

  async function confirmRoleChangeUser() {
    if (!confirmRoleChange) return;
    const { user, newRoles } = confirmRoleChange;
    setRoleChangeBusy(true);
    setError(null);
    const actionKey = `${user.id}:role`;
    setRowActionBusy(actionKey, true);
    setRowActionFeedback(actionKey, null);
    try {
      await patchUser(user.id, { roles: newRoles });
      showToast(`Roles updated for ${user.name || user.email}`);
      setConfirmRoleChange(null);
      reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not update roles';
      setRowActionFeedback(actionKey, { error: message });
      showToast(message);
    } finally {
      setRoleChangeBusy(false);
      setRowActionBusy(actionKey, false);
    }
  }

  async function handleReactivateDeleted(user) {
    const actionKey = `${user.id}:reactivate-deleted`;
    setRowActionBusy(actionKey, true);
    setRowActionFeedback(actionKey, null);
    setError(null);
    try {
      const result = await reactivateUser(user.id);
      const label = user.name || user.email;
      if (result?.reactivation?.requiresPassword) {
        showToast(`Reactivation link sent to ${user.email}`);
        flashRowFeedback(actionKey, { success: 'Link sent' });
      } else {
        showToast(`${label} reactivated`);
        flashRowFeedback(actionKey, { success: 'Reactivated' });
      }
      reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not reactivate';
      setRowActionFeedback(actionKey, { error: message });
      showToast(message);
    } finally {
      setRowActionBusy(actionKey, false);
    }
  }

  function requestDeactivate(user) {
    setConfirmDeactivate(user);
  }

  async function confirmDeactivateUser() {
    if (!confirmDeactivate) return;
    setDeactivateBusy(true);
    setError(null);
    const actionKey = `${confirmDeactivate.id}:deactivate`;
    try {
      await patchUser(confirmDeactivate.id, { status: 'inactive' });
      showToast(`${confirmDeactivate.name || confirmDeactivate.email} deactivated`);
      setConfirmDeactivate(null);
      reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not deactivate';
      setRowActionFeedback(actionKey, { error: message });
      showToast(message);
    } finally {
      setDeactivateBusy(false);
    }
  }

  function requestDelete(user) {
    setConfirmDelete(user);
  }

  async function confirmDeleteUser() {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    setError(null);
    const actionKey = `${confirmDelete.id}:delete`;
    try {
      await deleteUser(confirmDelete.id);
      showToast(`${confirmDelete.name || confirmDelete.email} deleted`);
      setConfirmDelete(null);
      reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not delete';
      setRowActionFeedback(actionKey, { error: message });
      showToast(message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleResend(user) {
    const actionKey = `${user.id}:resend`;
    setRowActionBusy(actionKey, true);
    setRowActionFeedback(actionKey, null);
    try {
      const result = await resendInvite(user.id);
      if (result?.sent) {
        showToast(`Invite sent to ${user.email}`);
        flashRowFeedback(actionKey, { success: 'Invite sent' });
      } else {
        const message = user.status === 'active'
          ? 'No invite sent — user is already active'
          : 'No invite sent — user is not pending invite';
        flashRowFeedback(actionKey, { error: message });
        showToast(message);
      }
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not send invite';
      setRowActionFeedback(actionKey, { error: message });
      showToast(message);
    } finally {
      setRowActionBusy(actionKey, false);
    }
  }

  async function handleImpersonate(user) {
    const actionKey = `${user.id}:impersonate`;
    setRowActionBusy(actionKey, true);
    setRowActionFeedback(actionKey, null);
    try {
      const impersonated = await startImpersonation(user.id, user.name || user.email);
      // Not '/': that page lives in the (auth) route group, so landing there
      // tears down the whole (app) tree, remounts AuthProvider, and burns two
      // extra /auth/refresh rotations before bouncing back into (app).
      router.replace(getDefaultRedirect(impersonated || user));
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not impersonate';
      setRowActionFeedback(actionKey, { error: message });
      showToast(message);
    } finally {
      setRowActionBusy(actionKey, false);
    }
  }

  const ensureScopeCatalog = useCallback(async () => {
    if (scopeCatalogLoaded) return;
    const [clientPage, projectPage] = await Promise.all([
      listClients({ limit: 100 }),
      listProjects({ limit: 200 }),
    ]);
    setClients(clientPage.results || []);
    setProjects(projectPage.results || []);
    setScopeCatalogLoaded(true);
  }, [scopeCatalogLoaded]);

  async function openAccessProfile(user) {
    setSelectedUser(user);
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerAssignments([]);
    setGrantOpen(false);
    setGrantError(null);
    setRevokeTarget(null);
    setRevokeReason('');

    try {
      await ensureScopeCatalog();
      const assignmentData = await listUserScopedAssignments(user.id);
      setDrawerAssignments(filterEffectivelyActiveAssignments(assignmentData.assignments || []));
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
    setGrantOpen(false);
    setGrantError(null);
    setRevokeTarget(null);
    setRevokeReason('');
  }

  async function refreshDrawerAssignments(userId) {
    const assignmentData = await listUserScopedAssignments(userId);
    const activeAssignments = filterEffectivelyActiveAssignments(assignmentData.assignments || []);
    setDrawerAssignments(activeAssignments);
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

  function clearListFilters() {
    setSearchInput('');
    setRoleFilter('');
    setStatusFilter('');
    setLimit(PEOPLE_PAGE_SIZES[0]);
    setPage(1);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="sub">Invite someone, set global roles, and manage scoped access assignments.</p>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setInviteOpen(true)}
        >
          Invite
        </button>
      </div>

      <InviteDialog
        open={inviteOpen}
        email={draft.email}
        role={draft.roles}
        roles={assignableRoles}
        error={error}
        busy={inviteBusy}
        onEmailChange={(event) => setDraft({ ...draft, email: event.target.value })}
        onRoleChange={(roles) => setDraft({ ...draft, roles })}
        onConfirm={invite}
        onCancel={closeInvite}
      />

      <div className="toolbar" role="region" aria-label="People filters">
        <input
          type="search"
          className="filterin"
          placeholder="Search name or email"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
            setPage(1);
          }}
          aria-label="Search people by name or email"
        />
        <select
          value={roleFilter}
          onChange={(event) => {
            setRoleFilter(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by role"
        >
          <option value="">Any role</option>
          {PEOPLE_FILTER_ROLES.map((role) => (
            <option key={role} value={role}>{ROLE_LABELS[role] || role}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {PEOPLE_FILTER_STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
        <span className="spacer" />
        <label className="pagesize">
          <span className="pagesize__label">Rows</span>
          <select
            value={limit}
            disabled={loadingUsers}
            onChange={(event) => {
              setLimit(Number(event.target.value) || PEOPLE_PAGE_SIZES[0]);
              setPage(1);
            }}
            aria-label="Rows per page"
          >
            {PEOPLE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size} / page</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-sm"
          onClick={clearListFilters}
          disabled={!listFiltersActive && page === 1 && limit === PEOPLE_PAGE_SIZES[0]}
        >
          Reset
        </button>
      </div>
      <p className="resultline" role="status" aria-live="polite">
        {loadingUsers
          ? 'Loading people…'
          : listPage.totalResults === 0
            ? 'No people found'
            : `${listPage.totalResults} people · showing ${showingFrom}-${showingTo}`}
      </p>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Email</th>
              <th>Roles</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="meta">
                  {loadingUsers
                    ? 'Loading people…'
                    : listFiltersActive
                      ? 'No users match these filters.'
                      : 'No users found.'}
                </td>
              </tr>
            ) : users.map((user) => {
              const deactivateKey = `${user.id}:deactivate`;
              const reactivateKey = `${user.id}:reactivate`;
              const resendKey = `${user.id}:resend`;
              const deleteKey = `${user.id}:delete`;
              const impersonateKey = `${user.id}:impersonate`;

              return (
                <tr key={user.id}>
                  <td>
                    <span className="personcell">
                      <span className="avatar sm">{initials(user.name || user.email)}</span>
                      {accountDeleted(user) && (
                        <span className="chip chip-sm">deleted</span>
                      )}
                      <span>{user.name || user.email}</span>
                    </span>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <RoleMultiSelect
                      value={getUserRoles(user)}
                      options={assignableRoles}
                      ariaLabel={`Roles for ${user.name || user.email}`}
                      busy={Boolean(rowBusy[`${user.id}:role`])}
                      onChange={(roles) => requestRoleChange(user, roles)}
                      disabled={accountDeleted(user)}
                    />
                  </td>
                  <td><span className="chip">{accountDeleted(user) ? 'deleted' : user.status}</span></td>
                  <td>
                    <div className="row-actions">
                      {user.status === 'active' && (
                        <ActionButton
                          label="Deactivate"
                          busyLabel="Deactivating…"
                          busy={Boolean(rowBusy[deactivateKey]) || deactivateBusy}
                          success={rowFeedback[deactivateKey]?.success}
                          error={rowFeedback[deactivateKey]?.error}
                          danger
                          onClick={() => requestDeactivate(user)}
                        />
                      )}
                      {user.status === 'inactive' && !accountDeleted(user) && (
                        <ActionButton
                          label="Reactivate"
                          busyLabel="Reactivating…"
                          busy={Boolean(rowBusy[reactivateKey])}
                          success={rowFeedback[reactivateKey]?.success}
                          error={rowFeedback[reactivateKey]?.error}
                          onClick={() => patchRow(
                            user.id,
                            { status: 'active' },
                            reactivateKey,
                            `${user.name} reactivated`,
                          )}
                        />
                      )}
                      {canReactivateDeleted(user) && (
                        <ActionButton
                          label="Reactivate"
                          busyLabel="Reactivating…"
                          busy={Boolean(rowBusy[`${user.id}:reactivate-deleted`])}
                          success={rowFeedback[`${user.id}:reactivate-deleted`]?.success}
                          error={rowFeedback[`${user.id}:reactivate-deleted`]?.error}
                          onClick={() => handleReactivateDeleted(user)}
                        />
                      )}
                      {user.status === 'invited' && (
                        <ActionButton
                          label="Resend"
                          busyLabel="Sending…"
                          busy={Boolean(rowBusy[resendKey])}
                          success={rowFeedback[resendKey]?.success}
                          error={rowFeedback[resendKey]?.error}
                          onClick={() => handleResend(user)}
                        />
                      )}
                      {!accountDeleted(user) && (
                        <ActionButton
                          label="Manage access"
                          busyLabel="Opening…"
                          busy={Boolean(rowBusy[`${user.id}:access`])}
                          onClick={() => openAccessProfile(user)}
                        />
                      )}
                      {canImpersonate && user.status === 'active' && user.id !== currentUser?.id
                        && !isSuperAdmin(user)
                        && !(hasAnyRole(currentUser, ROLE_IDS.ADMIN) && hasAnyRole(user, ROLE_IDS.ADMIN)) && (
                        <ActionButton
                          label="Impersonate"
                          icon="eye"
                          busyLabel="Impersonating…"
                          busy={Boolean(rowBusy[impersonateKey])}
                          success={rowFeedback[impersonateKey]?.success}
                          error={rowFeedback[impersonateKey]?.error}
                          onClick={() => handleImpersonate(user)}
                        />
                      )}
                      {!accountDeleted(user) && (
                      <ActionButton
                        label="Delete"
                        busyLabel="Deleting…"
                        busy={Boolean(rowBusy[deleteKey]) || deleteBusy}
                        success={rowFeedback[deleteKey]?.success}
                        error={rowFeedback[deleteKey]?.error}
                        danger
                        onClick={() => requestDelete(user)}
                      />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <nav className="pager" aria-label="People pagination">
        <div className="pager__meta">
          <span className="of">{listPage.totalResults} people</span>
          <span className="of">Showing {showingFrom}-{showingTo}</span>
          {(listPage.totalPages || 1) > 1 ? <span className="of">Page {page} of {listPage.totalPages}</span> : null}
        </div>
        <div className="pager__controls">
          <button
            type="button"
            className="pagebtn"
            aria-label="Previous page"
            disabled={page <= 1 || loadingUsers}
            onClick={() => setPage(page - 1)}
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
                  aria-current={item === page ? 'page' : undefined}
                  disabled={loadingUsers}
                  onClick={() => setPage(item)}
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
            disabled={page >= (listPage.totalPages || 1) || loadingUsers}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </nav>

      <ConfirmDialog
        open={Boolean(confirmDeactivate)}
        title={`Deactivate ${capRoles(confirmDeactivate)}?`}
        message={
          confirmDeactivate
            ? `${confirmDeactivate.name || confirmDeactivate.email} will lose access, but their ticket history stays.`
            : ''
        }
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        danger
        busy={deactivateBusy}
        onConfirm={confirmDeactivateUser}
        onCancel={() => {
          if (!deactivateBusy) setConfirmDeactivate(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={`Delete ${confirmDelete?.name || confirmDelete?.email}?`}
        message={
          confirmDelete
            ? 'They lose access. Their name stays on People as deleted, and ticket history is kept.'
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        busy={deleteBusy}
        onConfirm={confirmDeleteUser}
        onCancel={() => {
          if (!deleteBusy) setConfirmDelete(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmRoleChange)}
        title={
          confirmRoleChange?.toExternal
            ? 'Reduce access level?'
            : 'Grant elevated access?'
        }
        message={
          confirmRoleChange
            ? (confirmRoleChange.toExternal
              ? `Changing ${confirmRoleChange.user.name || confirmRoleChange.user.email} from ${formatRoleLabels(confirmRoleChange.oldRoles)} to ${formatRoleLabels(confirmRoleChange.newRoles)} may reduce their access level. They may lose access to internal tools and data. Continue?`
              : `Are you sure you want to change ${confirmRoleChange.user.name || confirmRoleChange.user.email} from ${formatRoleLabels(confirmRoleChange.oldRoles)} to ${formatRoleLabels(confirmRoleChange.newRoles)}? This will give this user much more access and control over the system.`)
            : ''
        }
        confirmLabel="Change role"
        cancelLabel="Cancel"
        danger={Boolean(confirmRoleChange?.toExternal)}
        busy={roleChangeBusy}
        onConfirm={confirmRoleChangeUser}
        onCancel={() => {
          if (!roleChangeBusy) setConfirmRoleChange(null);
        }}
      />

      <AccessProfileDrawer
        open={drawerOpen}
        user={selectedUser}
        assignments={drawerAssignments}
        clients={clients}
        projects={projects}
        loading={drawerLoading}
        grantBusy={grantBusy}
        grantError={grantError}
        grantOpen={grantOpen}
        revokeBusyId={revokeBusyId}
        showOverrides={false}
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
