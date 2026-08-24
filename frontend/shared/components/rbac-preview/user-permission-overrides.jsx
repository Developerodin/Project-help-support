'use client';

import { ROLE_LABELS } from '@pms/shared';
import {
  OVERRIDE_EDITABLE_PERMISSIONS,
  getRoleBaselinePermissions,
  getEffectivePermissions,
  getUserOverrideMap,
  roleBaselineHasPermission,
  userHasEffectivePermission,
} from '@/shared/lib/rbac-preview/matrix-utils.js';

const OVERRIDE_OPTIONS = [
  { value: 'inherit', label: 'Inherit from role' },
  { value: 'allow', label: 'Explicit allow' },
  { value: 'deny', label: 'Explicit deny' },
];

function formatGrantState(granted) {
  return granted ? 'Granted' : 'Denied';
}

function OverrideStateSelect({
  permission, state, baseline, effective, disabled, onChange,
}) {
  const selectId = `rbac-override-${permission}`;
  const helpId = `${selectId}-help`;
  const value = state || 'inherit';
  const changed = effective !== baseline;

  return (
    <div className="rbac-override-control">
      <label htmlFor={selectId} className="rbac-override-control__label">
        Override
      </label>
      <select
        id={selectId}
        className={`rbac-override-select${state ? ` is-${state}` : ''}`}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value === 'inherit' ? null : event.target.value;
          onChange(permission, next);
        }}
        aria-describedby={helpId}
      >
        {OVERRIDE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p id={helpId} className="rbac-override-select__help">
        Role baseline
        {' '}
        <strong>{formatGrantState(baseline)}</strong>
        .
        {' '}
        Effective outcome
        {' '}
        <strong>{formatGrantState(effective)}</strong>
        {changed ? ' (differs from role)' : ''}
        .
      </p>
    </div>
  );
}

export default function UserPermissionOverrides({
  user,
  overrides,
  permissionSummary = null,
  roleMatrixRecord = null,
  disabled = false,
  onOverrideChange,
}) {
  if (!user) return null;

  const userDeltas = getUserOverrideMap({ [user.id]: overrides }, user.id);
  const baseline = permissionSummary
    ? new Set(permissionSummary.baseline)
    : getRoleBaselinePermissions(user, roleMatrixRecord);
  const effective = permissionSummary
    ? new Set(permissionSummary.effective)
    : getEffectivePermissions(user, { roleMatrix: roleMatrixRecord, userOverrides: overrides });
  const primaryRole = user.roles?.[0] || user.role;

  return (
    <section className="rbac-user-overrides" aria-labelledby="rbac-user-overrides-title">
      <div className="rbac-user-overrides__head">
        <h3 id="rbac-user-overrides-title">Permission overrides</h3>
        <p className="rbac-user-overrides__lede">
          Set each permission to inherit from role, explicit allow, or explicit deny.
          Changes save immediately.
        </p>
      </div>

      <dl className="rbac-user-overrides__summary">
        <div>
          <dt>Primary role</dt>
          <dd>{primaryRole ? ROLE_LABELS[primaryRole] || primaryRole : 'None'}</dd>
        </div>
        <div>
          <dt>Role baseline grants</dt>
          <dd>{baseline.size}</dd>
        </div>
        <div>
          <dt>Effective grants</dt>
          <dd>{effective.size}</dd>
        </div>
        <div>
          <dt>Active overrides</dt>
          <dd>{Object.keys(userDeltas).length}</dd>
        </div>
      </dl>

      <ol className="rbac-override-list" aria-label="Permission override controls">
        {OVERRIDE_EDITABLE_PERMISSIONS.map((permission) => {
          const baselineGranted = permissionSummary
            ? permissionSummary.baseline.includes(permission)
            : roleBaselineHasPermission(user, permission, roleMatrixRecord);
          const effectiveGranted = permissionSummary
            ? permissionSummary.effective.includes(permission)
            : userHasEffectivePermission(user, permission, {
              roleMatrix: roleMatrixRecord,
              userOverrides: overrides,
            });
          const state = userDeltas[permission] || null;
          const changed = effectiveGranted !== baselineGranted;
          const rowState = state || 'inherit';

          return (
            <li
              key={permission}
              className={`rbac-override-row is-${rowState}${changed ? ' is-changed' : ''}`}
            >
              <div className="rbac-override-row__identity">
                <code className="rbac-override-row__perm">{permission}</code>
                <dl className="rbac-override-row__status">
                  <div>
                    <dt>Role baseline</dt>
                    <dd>{formatGrantState(baselineGranted)}</dd>
                  </div>
                  <div>
                    <dt>Effective</dt>
                    <dd>
                      {formatGrantState(effectiveGranted)}
                      {changed ? (
                        <span className="rbac-override-row__delta">Changed</span>
                      ) : null}
                    </dd>
                  </div>
                </dl>
              </div>

              <OverrideStateSelect
                permission={permission}
                state={state}
                baseline={baselineGranted}
                effective={effectiveGranted}
                disabled={disabled}
                onChange={onOverrideChange}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
