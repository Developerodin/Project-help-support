'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PEOPLE_ASSIGNABLE_ROLES, ROLE_IDS, IMPERSONATION_INITIATOR_ROLES, getUserRoles, hasAnyRole, isSuperAdmin } from '@pms/shared';
import { listUsers, inviteUser, patchUser, resendInvite, deleteUser } from '@/shared/api/users.js';
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
import { filterEffectivelyActiveAssignments } from '@/shared/lib/rbac-preview/matrix-utils.js';
import { commitAccessMutation } from '@/shared/lib/rbac-preview/people-access-mutations.js';
import { showToast } from '@/shared/lib/toast.js';
import { capRoles } from '@/shared/lib/profile-utils.js';
import '../../rbac-access.css';

/** Soft-deleted, including legacy hard-delete scrub rows (deleted+...@internal). */
function accountDeleted(user) {
  if (!user) return false;
  if (user.status === 'deleted') return true;
  const email = typeof user.email === 'string' ? user.email : '';
  return /^deleted\+[a-f0-9]{24}@internal$/i.test(email);
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
  const [draft, setDraft] = useState({ email: '', roles: [ROLE_IDS.UNASSIGNED] });
  const [error, setError] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
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

  const reload = useCallback(() => {
    listUsers({}).then((page) => setUsers(page.results)).catch(setError);
  }, []);

  useEffect(() => { reload(); }, [reload]);

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
      await startImpersonation(user.id);
      router.push('/');
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
            {users.map((user) => {
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
                      onChange={(roles) => patchRow(user.id, { roles }, `${user.id}:role`)}
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
