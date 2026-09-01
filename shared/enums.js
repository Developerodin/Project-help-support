/**
 * The stable, permission-bearing identifier for each role. Every permission
 * check, route gate, and DB query references ROLE_IDS.* — never a re-typed
 * string literal — so renaming how a role DISPLAYS (see ROLE_LABELS) never
 * touches a permission check, and vice versa.
 */
export const ROLE_IDS = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  PROJECT_ADMIN: 'project_admin',
  DEVELOPER: 'developer',
  TESTER: 'tester',
  SUPPORT: 'support',
  READ_ONLY: 'read_only',
  UNASSIGNED: 'unassigned',
  CLIENT: 'client',
  CLIENT_TESTER: 'client_tester',
});

/**
 * Internal roles, most to least administratively senior for display — not a
 * strict permission ladder, see docs/superpowers/specs/2026-08-17-role-model-v2-super-admin-isolation-design.md §1.
 */
export const INTERNAL_ROLES = Object.freeze([
  ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN, ROLE_IDS.PROJECT_ADMIN,
  ROLE_IDS.DEVELOPER, ROLE_IDS.TESTER, ROLE_IDS.SUPPORT, ROLE_IDS.READ_ONLY,
  ROLE_IDS.UNASSIGNED,
]);

/**
 * Wired into User.role (per the design spec §1's revision). External
 * capability is resolved via AccessAssignment, not internal permission bundles.
 */
export const EXTERNAL_ROLES = Object.freeze([ROLE_IDS.CLIENT, ROLE_IDS.CLIENT_TESTER]);

export const ROLES = Object.freeze([...INTERNAL_ROLES, ...EXTERNAL_ROLES]);

/**
 * Roles assignable via the People page (invite dialog and per-row role select).
 * Excludes super_admin (never assignable) and read_only (hidden until
 * production-ready). Includes external client roles — AccessAssignment sets scope,
 * and `unassigned` (no permissions) as the invite default.
 */
export const PEOPLE_ASSIGNABLE_ROLES = Object.freeze([
  // Listed first because it is the invite default, not because it is senior —
  // INTERNAL_ROLES still ranks it last for pickPrimaryRole.
  ROLE_IDS.UNASSIGNED,
  ...INTERNAL_ROLES.filter(
    (role) => role !== ROLE_IDS.SUPER_ADMIN
      && role !== ROLE_IDS.READ_ONLY
      && role !== ROLE_IDS.UNASSIGNED,
  ),
  ...EXTERNAL_ROLES,
]);

export const ROLE_LABELS = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: 'Super Admin',
  [ROLE_IDS.ADMIN]: 'Admin',
  [ROLE_IDS.PROJECT_ADMIN]: 'Project Admin',
  [ROLE_IDS.DEVELOPER]: 'Developer',
  [ROLE_IDS.TESTER]: 'Tester',
  [ROLE_IDS.SUPPORT]: 'Support',
  [ROLE_IDS.READ_ONLY]: 'Read Only',
  [ROLE_IDS.UNASSIGNED]: 'Unassigned',
  [ROLE_IDS.CLIENT]: 'Client',
  [ROLE_IDS.CLIENT_TESTER]: 'Client Tester',
});

/** Every route currently gated `requireRole('admin')` becomes `requireRole(...ADMIN_ROLES)` — see Task 4. */
export const ADMIN_ROLES = Object.freeze([ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN]);

/**
 * Gates who may INITIATE impersonation — a separate concept from ADMIN_ROLES
 * even though the values are identical today. A future admin-tier role added
 * to ADMIN_ROLES for route access must not silently also gain impersonation
 * rights without that being its own deliberate decision. See design spec §4.
 */
export const IMPERSONATION_INITIATOR_ROLES = Object.freeze([ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN]);

/** Every route currently gated `requireRole('admin', 'lead')` becomes `requireRole(...PROJECT_ADMIN_ROLES)`. */
export const PROJECT_ADMIN_ROLES = Object.freeze([
  ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN, ROLE_IDS.PROJECT_ADMIN,
]);

/** Roles that may set or change ticket resolution/release estimate dates. */
export const ESTIMATE_DATE_EDITOR_ROLES = Object.freeze([
  ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN, ROLE_IDS.PROJECT_ADMIN, ROLE_IDS.DEVELOPER,
]);

/** Per-project role on a team assigned to a project. Distinct from global User.role — do not conflate with ROLE_IDS. */
export const PROJECT_TEAM_ROLES = Object.freeze(['team_lead', 'developer', 'qa', 'member']);

/** Aligned with Dharwin devTicket.model.js severity enum. */
export const SEVERITIES = Object.freeze(['Minor', 'Major', 'Critical', 'Blocker']);

/** Aligned with Dharwin devTicket.model.js priority enum. */
export const PRIORITIES = Object.freeze(['Low', 'Medium', 'High', 'Urgent']);

/** Aligned with Dharwin devTicket.model.js category enum. */
export const CATEGORIES = Object.freeze(['Bug', 'New Feature', 'Improvement']);

/** Aligned with Dharwin devTicket.model.js labels enum. */
export const LABELS = Object.freeze([
  'regression',
  'needs-repro',
  'good-first-bug',
  'performance',
  'security',
  'ui',
]);

/** Aligned with Dharwin devTicket.model.js environment enum. */
export const ENVIRONMENTS = Object.freeze(['Staging', 'Production']);

/** Relationship types for Ticket.links[].rel — aligned with Dharwin LINK_RELS. */
export const LINK_RELS = Object.freeze(['blocks', 'blocked-by', 'duplicate-of', 'relates-to']);

/** Ticket.stageHistory[].decision — set only on the QA hops, null everywhere else. */
export const STAGE_DECISIONS = Object.freeze(['approved', 'rejected']);

/** Module catalog page screen types — list/detail/create/edit cover the common CRUD surfaces. */
export const SCREEN_TYPES = Object.freeze(['list', 'detail', 'create', 'edit', 'other']);

export const SCREEN_TYPE_LABELS = Object.freeze({
  list: 'List',
  detail: 'Detail',
  create: 'Create',
  edit: 'Edit',
  other: 'Other',
});

/** Lifecycle of a catalogued screen within a module page. */
export const SCREEN_STATUSES = Object.freeze(['active', 'draft', 'deprecated']);

export const SCREEN_STATUS_LABELS = Object.freeze({
  active: 'Active',
  draft: 'Draft',
  deprecated: 'Deprecated',
});

/** UI & QA workflow — distinct from catalog screen lifecycle statuses above. */
export const QA_STATUSES = Object.freeze(['open', 'review', 'in_progress', 'done']);

export const QA_STATUS_LABELS = Object.freeze({
  open: 'Open',
  review: 'Review',
  in_progress: 'In Progress',
  done: 'Done',
});