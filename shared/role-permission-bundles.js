import { ROLE_IDS, EXTERNAL_ROLES } from './enums.js';

/**
 * Code-defined permission registry and role bundles.
 * Stored in its own module so permission-resolution can import without cycles.
 */
export const PERMISSIONS = Object.freeze([
  'clients.view', 'clients.manage',
  'projects.view', 'projects.manage',
  'teams.view', 'teams.create', 'teams.edit', 'teams.delete',
  'tickets.view', 'tickets.create', 'tickets.edit', 'tickets.delete',
  'tickets.manage_assignment', 'tickets.manage_stage',
  'tickets.manage_comments', 'tickets.manage_attachments',
  'tickets.accept',
  'boards.view', 'boards.use',
  'users.view', 'users.manage',
  'access.view', 'access.grant', 'access.revoke',
  'audit.view',
]);

/** Old ticket permission keys → simplified model (used when loading stored matrix/overrides). */
export const PERMISSION_KEY_MIGRATION = Object.freeze({
  'tickets.update': 'tickets.edit',
  'tickets.assign': 'tickets.manage_assignment',
  'tickets.transition': 'tickets.manage_stage',
  'tickets.comment': 'tickets.manage_comments',
  'tickets.attach': 'tickets.manage_attachments',
  'tickets.watch': 'tickets.view',
  'tickets.block': 'tickets.edit',
  'tickets.close_reopen': 'tickets.accept',
  'teams.manage': 'teams.create',
});

/** Legacy teams.manage implied create, edit, and delete. */
export const PERMISSION_KEY_EXPANSIONS = Object.freeze({
  'teams.manage': ['teams.create', 'teams.edit', 'teams.delete'],
});

export function resolvePermissionKey(permission) {
  return PERMISSION_KEY_MIGRATION[permission] ?? permission;
}

export function migratePermissionKeys(permissions = []) {
  const migrated = new Set();
  for (const permission of permissions) {
    const expansions = PERMISSION_KEY_EXPANSIONS[permission];
    if (expansions) {
      for (const key of expansions) migrated.add(key);
      continue;
    }
    const next = resolvePermissionKey(permission);
    if (PERMISSIONS.includes(next)) migrated.add(next);
  }
  return [...migrated];
}

const VIEW_ONLY = Object.freeze(['clients.view', 'projects.view', 'teams.view', 'tickets.view', 'boards.view']);
const FULL_ADMIN_BUNDLE = PERMISSIONS;

const TICKET_ACTIONS = Object.freeze([
  'tickets.manage_comments', 'tickets.manage_attachments', 'tickets.manage_stage',
]);

const PROJECT_ADMIN = Object.freeze([
  'clients.view', 'projects.view', 'projects.manage',
  'teams.view', 'teams.create', 'teams.edit', 'teams.delete',
  'boards.view', 'boards.use',
  'tickets.view', 'tickets.create', 'tickets.edit', 'tickets.manage_assignment',
  ...TICKET_ACTIONS, 'users.view',
]);

const DEVELOPER = Object.freeze([
  ...VIEW_ONLY, 'boards.use', 'tickets.create', 'tickets.edit', ...TICKET_ACTIONS,
]);
const TESTER = Object.freeze([
  ...VIEW_ONLY, 'boards.use', 'tickets.create', 'tickets.edit', ...TICKET_ACTIONS,
]);
const SUPPORT = Object.freeze([
  ...VIEW_ONLY, 'tickets.create', 'tickets.edit', ...TICKET_ACTIONS,
]);
const READ_ONLY = VIEW_ONLY;
const UNASSIGNED = Object.freeze([]);
const CLIENT_BUNDLE = Object.freeze([]);

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: FULL_ADMIN_BUNDLE,
  [ROLE_IDS.ADMIN]: FULL_ADMIN_BUNDLE,
  [ROLE_IDS.PROJECT_ADMIN]: PROJECT_ADMIN,
  [ROLE_IDS.DEVELOPER]: DEVELOPER,
  [ROLE_IDS.TESTER]: TESTER,
  [ROLE_IDS.SUPPORT]: SUPPORT,
  [ROLE_IDS.READ_ONLY]: READ_ONLY,
  [ROLE_IDS.UNASSIGNED]: UNASSIGNED,
  [ROLE_IDS.CLIENT]: CLIENT_BUNDLE,
  [ROLE_IDS.CLIENT_TESTER]: CLIENT_BUNDLE,
});

for (const role of EXTERNAL_ROLES) {
  if (!(role in ROLE_PERMISSIONS)) throw new Error(`${role} is missing from ROLE_PERMISSIONS`);
}
