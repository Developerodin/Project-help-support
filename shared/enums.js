/** User roles. Authority in this product is this single field — there is no permission matrix. */
export const ROLES = Object.freeze(['admin', 'lead', 'qa', 'developer', 'member']);

/** Per-project role on a team assigned to a project. Distinct from global User.role. */
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