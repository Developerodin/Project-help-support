import { canBoardTransition, buildBoardRolePolicy } from './board-role-policy.js';

/**
 * THE single source of truth for stage ordering AND gate metadata.
 *
 * One ordered array, imported by both tiers: canTransition() on the server and
 * action availability on the client derive from the same rows and cannot drift.
 * Neither tier hardcodes a stage name anywhere.
 *
 * Keys are stable and snake_case. Labels live beside them, so renaming a stage
 * is a one-line edit rather than a data migration.
 */
/** Map global ROLE_IDS to legacy stage gate role strings (metadata / UI only). */
const STAGE_ROLE_ALIASES = Object.freeze({
  super_admin: 'admin',
  project_admin: 'lead',
  tester: 'qa',
});

export const STAGES = Object.freeze([
  { key: 'pending', index: 0, label: 'Pending', roles: [], relationships: [] },
  { key: 'under_review', index: 1, label: 'Under Review', roles: ['lead', 'admin'], relationships: [] },
  { key: 'in_progress', index: 2, label: 'In Progress', roles: ['lead', 'admin'], relationships: ['assignee'] },
  { key: 'ready_local', index: 3, label: 'Ready on Local', roles: ['admin'], relationships: ['assignee'] },
  { key: 'ready_qa', index: 4, label: 'Ready for QA', roles: ['admin'], relationships: ['assignee'] },
  { key: 'deployed_staging', index: 5, label: 'Deployed to Staging', roles: ['admin'], relationships: ['assignee'] },
  { key: 'qa_approved', index: 6, label: 'Staging QA Approved', roles: ['qa', 'admin'], relationships: [] },
  { key: 'ready_production', index: 7, label: 'Ready for Production', roles: ['lead', 'admin'], relationships: [] },
  { key: 'live', index: 8, label: 'Live', roles: ['admin'], relationships: [] },
  { key: 'closed', index: 9, label: 'Closed', roles: ['lead', 'admin', 'developer'], relationships: ['reporter'] },
].map(Object.freeze));

export const STAGE_KEYS = Object.freeze(STAGES.map((s) => s.key));

export const STAGE_BY_KEY = new Map(STAGES.map((s) => [s.key, s]));

export const stageIndex = (key) => (STAGE_BY_KEY.get(key)?.index ?? -1);
export const stageLabel = (key) => (STAGE_BY_KEY.get(key)?.label ?? key);

/** Ten columns do not fit a screen. Five collapsible lanes; cards still show the exact stage. */
export const LANES = Object.freeze([
  { key: 'intake', label: 'Intake', stages: ['pending', 'under_review'] },
  { key: 'development', label: 'Development', stages: ['in_progress', 'ready_local'] },
  { key: 'qa', label: 'QA', stages: ['ready_qa', 'deployed_staging', 'qa_approved'] },
  { key: 'release', label: 'Release', stages: ['ready_production', 'live'] },
  { key: 'done', label: 'Done', stages: ['closed'] },
].map(Object.freeze));

export const laneOf = (stageKey) => LANES.find((l) => l.stages.includes(stageKey))?.key ?? null;

/** Dragging a card into a lane transitions to that lane's FIRST stage. */
export const laneEntryStage = (laneKey) => LANES.find((l) => l.key === laneKey)?.stages[0] ?? null;

export const REOPEN_TARGET = 'in_progress';
export const REOPEN_MIN_INDEX = stageIndex('ready_qa');

/**
 * Reopen has its OWN gate rather than borrowing in_progress's.
 *
 * Destination gating alone (lead/admin/assignee) would make the QA-reject path
 * unreachable by the only role that performs QA: `qa` is none of those three,
 * and the design requires that rejecting a build IS a Reopen. Forward
 * transitions remain destination-gated, unchanged.
 */
export const REOPEN_ROLES = Object.freeze(['admin', 'lead', 'qa', 'developer']);
export const REOPEN_RELATIONSHIPS = Object.freeze(['assignee']);

/** Both estimates required to enter ANY stage at or past in_progress. */
export const GUARD_ESTIMATES_FROM_INDEX = stageIndex('in_progress');
/** team or assignedTo required to enter ANY stage at or past ready_qa. */
export const GUARD_OWNERSHIP_FROM_INDEX = stageIndex('ready_qa');

/** Mirrors backend checkGuards ownership rule for client-side preflight. */
export function wouldFailOwnershipGuard(to, ticket) {
  if (stageIndex(to) < GUARD_OWNERSHIP_FROM_INDEX) return false;
  return !ticket?.team && !ticket?.assignedTo;
}

export const QA_LANE_STAGES = Object.freeze(LANES.find((l) => l.key === 'qa').stages);

/**
 * A backward move out of the QA lane is a REJECTION, not a reopen — the ticket
 * was never closed. Callers use this to label the action and to require a QA
 * report. Everywhere else the same move is a reopen (regression or revival).
 */
export const isQaRejection = (from) => QA_LANE_STAGES.includes(from);

/**
 * Legality via centralized board-role policy. Guards (estimates, ownership) are
 * deliberately NOT here — they belong to the server's transition service.
 *
 * @param {object} [boardPolicy] - Effective board policy; defaults to code baseline.
 */
export function canTransition(
  from,
  to,
  actor,
  ticket,
  boardPolicy = buildBoardRolePolicy(),
  permissionContext = null,
) {
  return canBoardTransition(from, to, actor, ticket, boardPolicy, permissionContext);
}

/** What the client renders. The server re-checks every one of them. */
export function legalDestinations(
  from,
  actor,
  ticket,
  boardPolicy = buildBoardRolePolicy(),
  permissionContext = null,
) {
  return STAGE_KEYS.filter((key) => canTransition(
    from, key, actor, ticket, boardPolicy, permissionContext,
  ).ok);
}
