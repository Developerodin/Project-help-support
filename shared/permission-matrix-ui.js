import { EXTERNAL_ROLES } from './enums.js';
import { can } from './permissions.js';
import { PERMISSIONS } from './role-permission-bundles.js';
import { matrixHasPermission } from './permission-resolution.js';

export const PERMISSION_ACTION_KEYS = Object.freeze(['view', 'create', 'edit', 'delete']);

/**
 * Feature rows for the role-specific permission matrix.
 * Each action lists permission keys; an empty array means not applicable (—).
 */
export const PERMISSION_FEATURE_MATRIX = Object.freeze([
  {
    label: 'Projects',
    features: [
      {
        key: 'projects-module',
        label: 'Projects',
        actions: {
          view: ['clients.view', 'projects.view'],
          create: ['clients.manage', 'projects.manage'],
          edit: ['clients.manage', 'projects.manage'],
          delete: ['clients.manage', 'projects.manage'],
        },
      },
    ],
  },
  {
    label: 'Teams',
    features: [
      {
        key: 'teams',
        label: 'Teams',
        actions: {
          view: ['teams.view'],
          create: ['teams.create'],
          edit: ['teams.edit'],
          delete: ['teams.delete'],
        },
      },
    ],
  },
  {
    label: 'Tickets',
    features: [
      {
        key: 'tickets',
        label: 'Tickets',
        actions: {
          view: ['tickets.view'],
          create: ['tickets.create'],
          edit: ['tickets.edit'],
          delete: ['tickets.delete'],
        },
      },
      {
        key: 'tickets-assignment',
        label: 'Assignment',
        actions: {
          view: [],
          create: [],
          edit: ['tickets.manage_assignment'],
          delete: [],
        },
      },
      {
        key: 'tickets-stage',
        label: 'Stage transitions',
        actions: {
          view: [],
          create: [],
          edit: ['tickets.manage_stage'],
          delete: [],
        },
      },
      {
        key: 'tickets-comments',
        label: 'Comments',
        actions: {
          view: [],
          create: [],
          edit: ['tickets.manage_comments'],
          delete: [],
        },
      },
      {
        key: 'tickets-attachments',
        label: 'Attachments',
        actions: {
          view: [],
          create: [],
          edit: ['tickets.manage_attachments'],
          delete: [],
        },
      },
    ],
  },
  {
    label: 'People',
    features: [
      {
        key: 'users',
        label: 'Users',
        actions: {
          view: ['users.view'],
          create: ['users.manage'],
          edit: ['users.manage'],
          delete: ['users.manage'],
        },
      },
    ],
  },
  {
    label: 'Access control',
    features: [
      {
        key: 'access',
        label: 'Access management',
        actions: {
          view: ['access.view'],
          create: ['access.grant'],
          edit: ['access.grant'],
          delete: ['access.revoke'],
        },
      },
    ],
  },
  {
    label: 'Audit',
    features: [
      {
        key: 'audit',
        label: 'Audit log',
        actions: {
          view: ['audit.view'],
          create: [],
          edit: [],
          delete: [],
        },
      },
    ],
  },
]);

export const ALL_FEATURE_PERMISSIONS = Object.freeze(
  [...new Set(
    PERMISSION_FEATURE_MATRIX.flatMap((group) => group.features.flatMap((feature) => (
      PERMISSION_ACTION_KEYS.flatMap((action) => feature.actions[action] || [])
    ))),
  )].filter((permission) => PERMISSIONS.includes(permission)),
);

/** Role-level toggles shown only for external roles in the permission editor. */
export const EXTERNAL_ROLE_TOGGLE_PERMISSION = 'tickets.accept';

export const EXTERNAL_ROLE_TOGGLES = Object.freeze([
  {
    key: 'accept',
    label: 'Allow ticket acceptance',
    hint: 'Allow close on Live and reopen when not satisfactory',
    permission: EXTERNAL_ROLE_TOGGLE_PERMISSION,
  },
]);

export const EXTERNAL_TOGGLE_PERMISSIONS = Object.freeze(
  EXTERNAL_ROLE_TOGGLES.map((toggle) => toggle.permission),
);

function isTicketPermission(keys) {
  return keys.some((key) => key.startsWith('tickets.'));
}

export function actionPermissionKeys(actionKeys) {
  if (!actionKeys?.length) return null;
  return [...new Set(actionKeys)];
}

/** Whether this matrix cell is supported for the role (false → show —). */
export function isMatrixActionSupported(role, actionKeys) {
  const keys = actionPermissionKeys(actionKeys);
  if (!keys) return false;
  if (EXTERNAL_ROLES.includes(role) && isTicketPermission(keys)) return false;
  return true;
}

/** Whether the matrix cell should render an editable checkbox (editor mode only). */
export function isMatrixActionEditable(role, actionKeys, isEditMode = false) {
  if (!isEditMode) return false;
  return isMatrixActionSupported(role, actionKeys);
}

export function isFeatureActionGranted(snapshot, role, actionKeys) {
  if (!isMatrixActionSupported(role, actionKeys)) return null;
  const keys = actionPermissionKeys(actionKeys);
  if (!keys) return null;
  return keys.every((permission) => matrixHasPermission(snapshot, role, permission));
}

export function setFeatureActionGranted(snapshot, role, actionKeys, granted) {
  const keys = actionPermissionKeys(actionKeys);
  if (!keys || !snapshot?.[role]) return snapshot;
  for (const permission of keys) {
    if (granted) snapshot[role].add(permission);
    else snapshot[role].delete(permission);
  }
  return snapshot;
}

export function countRoleGrants(snapshot, role) {
  if (!snapshot?.[role]) return 0;
  const matrixPerms = ALL_FEATURE_PERMISSIONS.filter(
    (permission) => matrixHasPermission(snapshot, role, permission),
  );
  const togglePerms = EXTERNAL_ROLES.includes(role)
    ? EXTERNAL_TOGGLE_PERMISSIONS.filter(
      (permission) => matrixHasPermission(snapshot, role, permission),
    )
    : [];
  return matrixPerms.length + togglePerms.length;
}

export function isExternalRoleToggleGranted(snapshot, role, permission) {
  return matrixHasPermission(snapshot, role, permission);
}

export function setExternalRoleToggleGranted(snapshot, role, permission, granted) {
  if (!snapshot?.[role]) return snapshot;
  if (granted) snapshot[role].add(permission);
  else snapshot[role].delete(permission);
  return snapshot;
}

export function additionalPermissionsForRole(snapshot, role) {
  if (!snapshot?.[role]) return [];
  const known = new Set([...ALL_FEATURE_PERMISSIONS, ...EXTERNAL_TOGGLE_PERMISSIONS]);
  return [...snapshot[role]].filter((permission) => !known.has(permission)).sort();
}

export function canAccessProjectsModule(user, scopeOrContext = null) {
  return can(user, 'clients.view', scopeOrContext) && can(user, 'projects.view', scopeOrContext);
}

export function canManageProjectsModule(user, scopeOrContext = null) {
  return can(user, 'clients.manage', scopeOrContext) && can(user, 'projects.manage', scopeOrContext);
}
