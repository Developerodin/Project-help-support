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
  'tickets.accept',
  'ui_qa.view', 'ui_qa.create', 'ui_qa.edit', 'ui_qa.delete',
  'boards.view', 'boards.use',
  'users.view', 'users.manage',
  'access.view', 'access.grant', 'access.revoke',
  'audit.view',
]);

/** Old ticket permission keys → simplified model (used when loading stored matrix/overrides). */
export const PERMISSION_KEY_MIGRATION = Object.freeze({
  'tickets.update': 'tickets.edit',
  'tickets.assign': 'tickets.edit',
  'tickets.manage_assignment': 'tickets.edit',
  'tickets.transition': 'tickets.edit',
  'tickets.comment': 'tickets.view',
  'tickets.attach': 'tickets.view',
  'tickets.manage_stage': 'tickets.edit',
  'tickets.manage_comments': 'tickets.view',
  'tickets.manage_attachments': 'tickets.view',
  'tickets.watch': 'tickets.view',
  'tickets.block': 'tickets.edit',
  'tickets.close_reopen': 'tickets.accept',
  'tickets.manage_stage': 'ui_qa.edit',
  'tickets.manage_comments': 'ui_qa.edit',
  'tickets.manage_attachments': 'ui_qa.delete',
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

const VIEW_ONLY = Object.freeze([
  'clients.view', 'projects.view', 'teams.view', 'tickets.view', 'boards.view', 'ui_qa.view',
]);
const FULL_ADMIN_BUNDLE = PERMISSIONS;

const PROJECT_ADMIN = Object.freeze([
  'clients.view', 'projects.view', 'projects.manage',
  'teams.view', 'teams.create', 'teams.edit', 'teams.delete',
  'boards.view', 'boards.use',
  'tickets.view', 'tickets.create', 'tickets.edit',
  'ui_qa.view', 'ui_qa.edit',
  'users.view',
]);

const DEVELOPER = Object.freeze([
  ...VIEW_ONLY, 'boards.use', 'tickets.create', 'tickets.edit', 'ui_qa.edit',
]);
const TESTER = Object.freeze([
  ...VIEW_ONLY, 'boards.use', 'tickets.create', 'tickets.edit', 'ui_qa.edit',
]);
const SUPPORT = Object.freeze([
  ...VIEW_ONLY, 'tickets.create', 'tickets.edit', 'ui_qa.edit',
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
