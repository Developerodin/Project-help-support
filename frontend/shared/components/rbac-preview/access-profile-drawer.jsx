'use client';

import { ROLE_LABELS } from '@pms/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import AppLoader from '@/shared/components/app-loader.jsx';
import GrantAccessDialog from '@/shared/components/rbac-preview/grant-access-dialog.jsx';
import { formatScope } from '@/shared/lib/rbac-preview/matrix-utils.js';
import UserPermissionOverrides from '@/shared/components/rbac-preview/user-permission-overrides.jsx';

function ScopeCell({ clientId, projectId, clients = [], projects = [] }) {
  const clientName = clients.find((item) => item.id === clientId)?.name;
  const projectName = projects.find((item) => item.id === projectId)?.name;
  const scope = formatScope({ clientId, projectId, clientName, projectName });
  return (
    <span className={scope.global ? 'rbac-scope rbac-scope--global' : 'rbac-scope'}>
      <span>{scope.client}</span>
      <span className="rbac-scope__sep" aria-hidden="true">/</span>
      <span>{scope.project}</span>
    </span>
  );
}

export default function AccessProfileDrawer({
  open,
  user,
  assignments,
  overrides,
  permissionSummary = null,
  roleMatrixRecord = null,
  clients = [],
  projects = [],
  loading = false,
  overrideSaveBusy = false,
  grantBusy = false,
  grantError = null,
  revokeBusyId = null,
  onOverrideChange,
  onGrantOpen,
  onGrantConfirm,
  onGrantCancel,
  grantOpen = false,
  onRevoke,
  onClose,
  showOverrides = true,
}) {
  const name = user?.name || user?.email || 'Person';

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
        <SheetContent side="right" className="rbac-access-drawer sm:max-w-2xl">
          <SheetHeader className="rbac-access-drawer__header">
            <SheetTitle>Access profile — {name}</SheetTitle>
            <SheetDescription>
              {showOverrides
                ? 'Per-user overrides and scoped role assignments.'
                : 'Scoped role assignments for this person.'}
            </SheetDescription>
          </SheetHeader>

          <div className="rbac-access-drawer__body">
            {loading ? (
              <AppLoader inline label="Loading access profile…" ariaLabel="Loading access profile" />
            ) : (
              <>
                {showOverrides && (
                  <UserPermissionOverrides
                    user={user}
                    overrides={overrides}
                    permissionSummary={permissionSummary}
                    roleMatrixRecord={roleMatrixRecord}
                    disabled={overrideSaveBusy}
                    onOverrideChange={onOverrideChange}
                  />
                )}

                <section
                  className={`rbac-scoped-assignments${showOverrides ? '' : ' rbac-scoped-assignments--only'}`}
                  aria-labelledby="rbac-scoped-assignments-title"
                >
                  <div className="rbac-scoped-assignments__head">
                    <h3 id="rbac-scoped-assignments-title">Scoped assignments</h3>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={grantBusy || !user}
                      onClick={onGrantOpen}
                    >
                      Grant access
                    </button>
                  </div>

                  {assignments.length === 0 ? (
                    <div className="empty-state rbac-scoped-empty">
                      <h3>No assignments</h3>
                      <p>Grant access to give this person a role in a client or project.</p>
                    </div>
                  ) : (
                    <ul className="rbac-assignment-list">
                      {assignments.map((row) => (
                        <li key={row.id} className="rbac-assignment-card">
                          <div className="rbac-assignment-card__head">
                            <span className="chip chip-sm">{ROLE_LABELS[row.role] || row.role}</span>
                            <span className="chip chip-sm">{row.status}</span>
                            {row.status === 'active' && onRevoke && (
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                disabled={grantBusy || revokeBusyId === row.id}
                                onClick={() => onRevoke(row)}
                              >
                                {revokeBusyId === row.id ? 'Revoking…' : 'Revoke'}
                              </button>
                            )}
                          </div>
                          <ScopeCell
                            clientId={row.clientId}
                            projectId={row.projectId}
                            clients={clients}
                            projects={projects}
                          />
                          <dl className="rbac-assignment-meta">
                            <div>
                              <dt>Environments</dt>
                              <dd>{row.environments.length ? row.environments.join(', ') : 'None (no ticket access)'}</dd>
                            </div>
                            {row.grantedBy && (
                              <div>
                                <dt>Granted by</dt>
                                <dd>{row.grantedBy}</dd>
                              </div>
                            )}
                            {row.reason && (
                              <div>
                                <dt>Reason</dt>
                                <dd>{row.reason}</dd>
                              </div>
                            )}
                          </dl>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>

          <div className="rbac-access-drawer__actions">
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        </SheetContent>
      </Sheet>

      <GrantAccessDialog
        open={grantOpen}
        user={user}
        clients={clients}
        projects={projects}
        error={grantError}
        busy={grantBusy}
        onConfirm={onGrantConfirm}
        onCancel={onGrantCancel}
      />
    </>
  );
}
