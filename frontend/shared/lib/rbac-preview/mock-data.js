import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_IDS,
  ROLE_LABELS,
  INTERNAL_ROLES,
  EXTERNAL_ROLES,
} from '@pms/shared';

export const MOCK_CLIENTS = [
  { id: 'cli_acme', name: 'Acme Pharma', status: 'active', projectCount: 3 },
  { id: 'cli_nova', name: 'Nova Biotech', status: 'active', projectCount: 1 },
  { id: 'cli_orion', name: 'Orion Health', status: 'archived', projectCount: 2 },
];

export const MOCK_PROJECTS = [
  { id: 'prj_portal', name: 'Patient Portal', clientId: 'cli_acme' },
  { id: 'prj_lims', name: 'LIMS Integration', clientId: 'cli_acme' },
  { id: 'prj_uat', name: 'UAT Wave 2', clientId: 'cli_nova' },
];

export const MOCK_USERS = [
  {
    id: 'usr_1',
    name: 'Priya Sharma',
    email: 'priya@prowplus.internal',
    status: 'active',
    roles: [ROLE_IDS.SUPER_ADMIN],
  },
  {
    id: 'usr_2',
    name: 'Marcus Chen',
    email: 'marcus@prowplus.internal',
    status: 'active',
    roles: [ROLE_IDS.ADMIN],
  },
  {
    id: 'usr_3',
    name: 'Elena Voss',
    email: 'elena@prowplus.internal',
    status: 'active',
    roles: [ROLE_IDS.PROJECT_ADMIN, ROLE_IDS.DEVELOPER],
  },
  {
    id: 'usr_4',
    name: 'Jordan Lee',
    email: 'jordan@client-acme.com',
    status: 'active',
    roles: [ROLE_IDS.CLIENT],
  },
  {
    id: 'usr_5',
    name: 'Sam Okonkwo',
    email: 'sam@prowplus.internal',
    status: 'invited',
    roles: [ROLE_IDS.UNASSIGNED],
  },
  {
    id: 'usr_6',
    name: 'Alex Rivera',
    email: 'alex@prowplus.internal',
    status: 'active',
    roles: [ROLE_IDS.DEVELOPER],
  },
  {
    id: 'usr_7',
    name: 'Casey Kim',
    email: 'casey@prowplus.internal',
    status: 'active',
    roles: [ROLE_IDS.DEVELOPER],
  },
];

/**
 * Per-user permission deltas on top of role baseline.
 * Values: 'allow' | 'deny'. Absent keys inherit from role bundle.
 */
export const MOCK_USER_OVERRIDES = {
  usr_6: {
    'tickets.manage_assignment': 'allow',
  },
  usr_7: {
    'tickets.create': 'deny',
  },
};

/** Small subset surfaced in the People override editor (preview only). */
export const OVERRIDE_EDITABLE_PERMISSIONS = [
  'tickets.create',
  'tickets.edit',
  'tickets.delete',
  'tickets.manage_assignment',
  'users.manage',
  'access.grant',
];

export const MOCK_ASSIGNMENTS = [
  {
    id: 'asg_1',
    userId: 'usr_1',
    role: ROLE_IDS.SUPER_ADMIN,
    clientId: null,
    projectId: null,
    environments: [],
    status: 'active',
    grantedBy: 'Bootstrap',
    reason: 'Initial global super admin',
  },
  {
    id: 'asg_2',
    userId: 'usr_3',
    role: ROLE_IDS.PROJECT_ADMIN,
    clientId: 'cli_acme',
    projectId: 'prj_portal',
    environments: ['Development', 'Staging'],
    status: 'active',
    grantedBy: 'Marcus Chen',
    reason: 'Portal delivery lead',
  },
  {
    id: 'asg_3',
    userId: 'usr_3',
    role: ROLE_IDS.DEVELOPER,
    clientId: 'cli_acme',
    projectId: 'prj_lims',
    environments: ['Development', 'Staging', 'Production'],
    status: 'active',
    grantedBy: 'Marcus Chen',
    reason: 'Production hotfix access',
  },
  {
    id: 'asg_4',
    userId: 'usr_4',
    role: ROLE_IDS.CLIENT,
    clientId: 'cli_acme',
    projectId: null,
    environments: [],
    status: 'active',
    grantedBy: 'Marcus Chen',
    reason: 'Company-wide client visibility',
  },
];

export const PERMISSION_GROUPS = [
  { label: 'Clients', permissions: ['clients.view', 'clients.manage'] },
  { label: 'Projects', permissions: ['projects.view', 'projects.manage'] },
  { label: 'Teams', permissions: ['teams.view', 'teams.create', 'teams.edit', 'teams.delete'] },
  { label: 'Tickets', permissions: [
    'tickets.view', 'tickets.create', 'tickets.edit', 'tickets.delete',
    'tickets.manage_assignment', 'tickets.manage_stage',
    'tickets.manage_comments', 'tickets.manage_attachments',
    'tickets.accept',
  ] },
  { label: 'People', permissions: ['users.view', 'users.manage'] },
  { label: 'Access control', permissions: ['access.view', 'access.grant', 'access.revoke'] },
  { label: 'Audit', permissions: ['audit.view'] },
];

export const MATRIX_ROLES = [
  ...INTERNAL_ROLES.filter((r) => r !== ROLE_IDS.UNASSIGNED),
  ...EXTERNAL_ROLES,
];

export function roleHasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

/** Clone ROLE_PERMISSIONS into a draft-editable matrix (preview only). */
export function buildMatrixSnapshot(source = ROLE_PERMISSIONS) {
  const snapshot = {};
  for (const role of MATRIX_ROLES) {
    snapshot[role] = new Set(source[role] || []);
  }
  return snapshot;
}

export function cloneMatrixSnapshot(snapshot) {
  const clone = {};
  for (const role of MATRIX_ROLES) {
    clone[role] = new Set(snapshot[role] || []);
  }
  return clone;
}

export function matrixHasPermission(snapshot, role, permission) {
  return snapshot[role]?.has(permission) ?? false;
}

export function diffMatrixSnapshots(fromSnapshot, toSnapshot) {
  const changes = [];
  for (const role of MATRIX_ROLES) {
    for (const permission of PERMISSIONS) {
      const before = matrixHasPermission(fromSnapshot, role, permission);
      const after = matrixHasPermission(toSnapshot, role, permission);
      if (before === after) continue;
      changes.push({ role, permission, before, after });
    }
  }
  return changes;
}

export function formatScope({ clientId, projectId }) {
  if (!clientId && !projectId) return { client: 'All clients', project: 'All projects', global: true };
  const client = MOCK_CLIENTS.find((c) => c.id === clientId);
  const project = MOCK_PROJECTS.find((p) => p.id === projectId);
  return {
    client: client?.name || 'Unknown client',
    project: project?.name || (clientId && !projectId ? 'All projects' : '—'),
    global: false,
  };
}

export function assignmentsForUser(userId) {
  return MOCK_ASSIGNMENTS.filter((a) => a.userId === userId && a.status === 'active');
}

export function cloneUserOverrides(source = MOCK_USER_OVERRIDES) {
  const clone = {};
  for (const [userId, deltas] of Object.entries(source)) {
    clone[userId] = { ...deltas };
  }
  return clone;
}

export function getUserOverrideMap(overrides, userId) {
  return overrides[userId] || {};
}

export function countUserOverrides(overrides, userId) {
  return Object.keys(getUserOverrideMap(overrides, userId)).length;
}

/** Union of all role-bundle grants for a user (no per-user deltas). */
export function getRoleBaselinePermissions(user) {
  const perms = new Set();
  if (!user?.roles?.length) return perms;
  for (const role of user.roles) {
    for (const permission of ROLE_PERMISSIONS[role] || []) perms.add(permission);
  }
  return perms;
}

export function roleBaselineHasPermission(user, permission) {
  return getRoleBaselinePermissions(user).has(permission);
}

/**
 * Effective grants = role baseline with per-user allow/deny deltas applied.
 * Deny wins over baseline; allow can add permissions not in the role bundle.
 */
export function getEffectivePermissions(user, overrides = MOCK_USER_OVERRIDES) {
  const effective = new Set(getRoleBaselinePermissions(user));
  const deltas = getUserOverrideMap(overrides, user?.id);
  for (const [permission, delta] of Object.entries(deltas)) {
    if (delta === 'allow') effective.add(permission);
    else if (delta === 'deny') effective.delete(permission);
  }
  return effective;
}

export function userHasEffectivePermission(user, permission, overrides = MOCK_USER_OVERRIDES) {
  return getEffectivePermissions(user, overrides).has(permission);
}

export function cycleOverrideState(current) {
  if (!current) return 'allow';
  if (current === 'allow') return 'deny';
  return null;
}

export { PERMISSIONS, ROLE_LABELS, ROLE_IDS };
