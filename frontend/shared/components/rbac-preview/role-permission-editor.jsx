'use client';

import Link from 'next/link';
import {
  PERMISSION_ACTION_KEYS,
  PERMISSION_FEATURE_MATRIX,
  ROLE_LABELS,
  EXTERNAL_ROLES,
  EXTERNAL_ROLE_TOGGLES,
  isFeatureActionGranted,
  isMatrixActionSupported,
  isMatrixActionEditable,
  isExternalRoleToggleGranted,
  additionalPermissionsForRole,
} from '@pms/shared';
import Icon from '@/shared/components/icons.jsx';
import BoardPermissionEditor from '@/shared/components/rbac-preview/board-permission-editor.jsx';

const ACTION_LABELS = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
};

function PermissionCell({
  feature,
  action,
  keys,
  granted,
  supported,
  editable,
  onToggle,
}) {
  if (!supported) {
    return (
      <td className="rbac-perm-cell rbac-perm-cell--na">
        <span className="rbac-perm-mark rbac-perm-mark--na" aria-hidden="true">—</span>
      </td>
    );
  }

  if (editable) {
    return (
      <td className="rbac-perm-cell rbac-perm-cell--edit">
        <label className="rbac-perm-check">
          <input
            type="checkbox"
            className="rbac-perm-check__input"
            checked={Boolean(granted)}
            onChange={() => onToggle(feature.key, action, keys, !granted)}
            aria-label={`${feature.label}: ${ACTION_LABELS[action]}. ${granted ? 'Granted' : 'Denied'}.`}
          />
          <span className="rbac-perm-check__box" aria-hidden="true" />
        </label>
      </td>
    );
  }

  return (
    <td className="rbac-perm-cell">
      {granted ? (
        <span className="rbac-perm-mark rbac-perm-mark--granted" aria-label="Granted">✓</span>
      ) : (
        <span className="rbac-perm-mark rbac-perm-mark--denied rbac-perm-mark--unchecked" aria-label="Denied" />
      )}
    </td>
  );
}

export default function RolePermissionEditor({
  role,
  snapshot,
  mode = 'view',
  onToggleAction,
  onTogglePermission,
  boardSnapshot = null,
  onToggleBoardCapability = null,
}) {
  const extras = additionalPermissionsForRole(snapshot, role);
  const isEdit = mode === 'edit';

  return (
    <div className={`rbac-role-permissions${isEdit ? ' rbac-role-permissions--edit' : ' rbac-role-permissions--read'}`}>
      {PERMISSION_FEATURE_MATRIX.map((group) => (
        <section key={group.label} className="rbac-role-permissions__group">
          <header className="rbac-role-permissions__group-head">
            <h2>{group.label}</h2>
          </header>
          <div className="rbac-role-permissions__table-wrap">
            <table className="rbac-role-permissions__table">
              <thead>
                <tr>
                  <th scope="col" className="rbac-role-permissions__feature-col">Feature</th>
                  {PERMISSION_ACTION_KEYS.map((action) => (
                    <th key={action} scope="col" className="rbac-role-permissions__action-col">
                      {ACTION_LABELS[action]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.features.map((feature, index) => (
                  <tr
                    key={feature.key}
                    className={index > 0 ? 'rbac-role-permissions__row--child' : undefined}
                  >
                    <th scope="row" className="rbac-role-permissions__feature-name">
                      {feature.label}
                    </th>
                    {PERMISSION_ACTION_KEYS.map((action) => {
                      const keys = feature.actions[action];
                      const supported = isMatrixActionSupported(role, keys);
                      const granted = isFeatureActionGranted(snapshot, role, keys);
                      const editable = isMatrixActionEditable(role, keys, isEdit);

                      return (
                        <PermissionCell
                          key={action}
                          feature={feature}
                          action={action}
                          keys={keys}
                          granted={granted}
                          supported={supported}
                          editable={editable}
                          onToggle={onToggleAction}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {group.label === 'Board' && boardSnapshot && onToggleBoardCapability && (
            <>
              <p className="meta rbac-board-role__lane-hint">
                Lane capabilities for Intake → Development → QA → Release → Done.
              </p>
              <BoardPermissionEditor
                role={role}
                snapshot={boardSnapshot}
                mode={mode}
                onToggleCapability={onToggleBoardCapability}
                embedded
              />
            </>
          )}
        </section>
      ))}

      {EXTERNAL_ROLES.includes(role) && (
        <section className="rbac-role-permissions__group rbac-role-permissions__external-toggles">
          <header className="rbac-role-permissions__group-head">
            <h2>External ticket workflow</h2>
          </header>
          {EXTERNAL_ROLE_TOGGLES.map((toggle) => {
            const granted = isExternalRoleToggleGranted(snapshot, role, toggle.permission);
            const rowClass = `rbac-workflow-toggle${isEdit ? '' : ' rbac-workflow-toggle--read'}`;

            if (!isEdit) {
              return (
                <div key={toggle.key} className={rowClass}>
                  <div className="rbac-workflow-toggle__copy">
                    <span className="rbac-workflow-toggle__label">{toggle.label}</span>
                    <span className="rbac-workflow-toggle__hint">{toggle.hint}</span>
                  </div>
                  <div className="rbac-workflow-toggle__control">
                    <span className={`chip${granted ? ' chip-active' : ''}`}>
                      {granted ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <label key={toggle.key} className={rowClass}>
                <input
                  type="checkbox"
                  className="rbac-workflow-toggle__input"
                  checked={Boolean(granted)}
                  onChange={() => onTogglePermission(toggle.permission, !granted)}
                  role="switch"
                  aria-checked={granted}
                  aria-label={`${toggle.label}. ${granted ? 'On' : 'Off'}.`}
                />
                <div className="rbac-workflow-toggle__copy">
                  <span className="rbac-workflow-toggle__label">{toggle.label}</span>
                  <span className="rbac-workflow-toggle__hint">{toggle.hint}</span>
                </div>
                <div className="rbac-workflow-toggle__control">
                  <span className="rbac-workflow-toggle__track" aria-hidden="true">
                    <span className="rbac-workflow-toggle__thumb" />
                  </span>
                  <span className="rbac-workflow-toggle__state" aria-hidden="true">
                    {granted ? 'On' : 'Off'}
                  </span>
                </div>
              </label>
            );
          })}
        </section>
      )}

      {extras.length > 0 && (
        <section className="rbac-role-permissions__extras">
          <header className="rbac-role-permissions__group-head">
            <h2>Additional permissions</h2>
            <p className="meta">Permissions granted to this role that are not represented in the matrix above.</p>
          </header>
          <ul className="rbac-role-permissions__extra-list">
            {extras.map((permission) => {
              const granted = snapshot?.[role]?.has(permission);
              return (
                <li key={permission}>
                  <code>{permission}</code>
                  {isEdit ? (
                    <label className="rbac-perm-check rbac-perm-check--inline">
                      <input
                        type="checkbox"
                        className="rbac-perm-check__input"
                        checked={Boolean(granted)}
                        onChange={() => onTogglePermission(permission, !granted)}
                        aria-label={`${permission}. ${granted ? 'Granted' : 'Denied'}.`}
                      />
                      <span className="rbac-perm-check__box" aria-hidden="true" />
                      <span className="rbac-perm-check__text">{granted ? 'Granted' : 'Denied'}</span>
                    </label>
                  ) : (
                    <span className="rbac-perm-mark rbac-perm-mark--granted">✓</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

export function RolePermissionPageHead({ role, grantCount, onBackHref = '/settings/rbac-preview/matrix' }) {
  const label = ROLE_LABELS[role] || role;
  const initial = label.charAt(0).toUpperCase();

  return (
    <div className="rbac-role-head">
      <div className="rbac-role-head__identity">
        <span className="rbac-role-head__avatar" aria-hidden="true">{initial}</span>
        <div>
          <p className="rbac-role-head__eyebrow">Role permissions</p>
          <h1>{label}</h1>
          <p className="sub">
            {grantCount}
            {' '}
            permission
            {grantCount === 1 ? '' : 's'}
            {' '}
            granted for this role.
          </p>
        </div>
      </div>
      <div className="rbac-role-head__meta">
        <div className="rbac-role-head__field">
          <span className="rbac-role-head__label">Role name</span>
          <strong>{label}</strong>
        </div>
        <div className="rbac-role-head__field">
          <span className="rbac-role-head__label">Status</span>
          <span className="chip chip-active">Active</span>
        </div>
        <Link href={onBackHref} className="btn btn-sm">
          <Icon name="chev-left" size={14} />
          Back to roles
        </Link>
      </div>
    </div>
  );
}
