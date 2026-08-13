/** User roles. Authority in this product is this single field — there is no permission matrix. */
export const ROLES = Object.freeze(['admin', 'lead', 'qa', 'developer', 'member']);

export const SEVERITIES = Object.freeze(['critical', 'major', 'minor', 'trivial']);

export const PRIORITIES = Object.freeze(['urgent', 'high', 'medium', 'low']);

export const CATEGORIES = Object.freeze([
  'bug', 'ui', 'performance', 'data', 'security', 'enhancement', 'question',
]);

export const LABELS = Object.freeze([
  'blocker', 'regression', 'needs-info', 'duplicate', 'wont-fix', 'good-first-issue',
]);

/** Relationship types for Ticket.links[].rel */
export const LINK_RELS = Object.freeze(['blocks', 'blocked-by', 'duplicates', 'relates-to']);

/** Ticket.stageHistory[].decision — set only on the QA hops, null everywhere else. */
export const STAGE_DECISIONS = Object.freeze(['approved', 'rejected']);