import { isExternalUser } from './permissions.js';

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
/** Map global ROLE_IDS to legacy stage gate role strings. */
const STAGE_ROLE_ALIASES = Object.freeze({
  super_admin: 'admin',
  project_admin: 'lead',
  tester: 'qa',
});

function getUserRoles(user) {
  if (!user) return [];
  const roles = user.roles;
  if (Array.isArray(roles) && roles.length > 0) return [...new Set(roles)];
  if (user.role) return [user.role];
  return [];
}

function getActorStageRoles(actor) {
  const roles = getUserRoles(actor);
  const expanded = new Set(roles);
  for (const role of roles) {
    const alias = STAGE_ROLE_ALIASES[role];
    if (alias) expanded.add(alias);
  }
  return [...expanded];
}

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
  { key: 'closed', index: 9, label: 'Closed', roles: ['lead', 'admin'], relationships: ['reporter'] },
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
export const REOPEN_ROLES = Object.freeze(['admin', 'lead', 'qa']);
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

const QA_LANE_STAGES = Object.freeze(LANES.find((l) => l.key === 'qa').stages);

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

function hasRelationship(relationship, actor, ticket) {
  const actorId = idOf(actor?._id ?? actor?.id);
  if (!actorId) return false;
  if (relationship === 'assignee') return idOf(ticket?.assignedTo) === actorId;
  if (relationship === 'reporter') return idOf(ticket?.createdBy) === actorId;
  return false;
}

function passes({ roles, relationships }, actor, ticket) {
  const actorRoles = getActorStageRoles(actor);
  if (roles.some((role) => actorRoles.includes(role))) return true;
  return relationships.some((rel) => hasRelationship(rel, actor, ticket));
}

const refuse = (code, reason) => ({ ok: false, code, reason });

/**
 * Legality only. This never grants ACCESS — a member who reaches the transition
 * endpoint on a ticket they cannot touch has already failed resource
 * authorization. Keeping the two separate is what stops a domain rule from
 * quietly becoming a permission check.
 *
 * The guards (estimates, ownership) are deliberately NOT here: they need the
 * ticket's own fields and belong to the server's transition service, while this
 * function also runs in the browser to decide which buttons to render.
 */
export function canTransition(from, to, actor, ticket) {
  const fromStage = STAGE_BY_KEY.get(from);
  const toStage = STAGE_BY_KEY.get(to);

  if (!fromStage) return refuse('UNKNOWN_STAGE', `"${from}" is not a stage`);
  if (!toStage) return refuse('UNKNOWN_STAGE', `"${to}" is not a stage`);
  if (fromStage.index === toStage.index) {
    return refuse('SAME_STAGE', `The ticket is already in ${toStage.label}`);
  }

  if (isExternalUser(actor)) {
    if (from === 'live' && to === 'closed') {
      return { ok: true, isReopen: false, isClose: true, decision: null };
    }
    return refuse(
      'STAGE_NOT_PERMITTED',
      'Clients may only move Live tickets to Closed',
    );
  }

  const isReopen = toStage.index < fromStage.index;

  if (isReopen) {
    if (to !== REOPEN_TARGET) {
      return refuse(
        'ILLEGAL_BACKWARD',
        `The only backward move is a Reopen to ${stageLabel(REOPEN_TARGET)}`,
      );
    }
    if (fromStage.index < REOPEN_MIN_INDEX) {
      return refuse('REOPEN_TOO_EARLY', `Reopen is available from ${stageLabel('ready_qa')} onward`);
    }
    if (!passes({ roles: REOPEN_ROLES, relationships: REOPEN_RELATIONSHIPS }, actor, ticket)) {
      return refuse('STAGE_NOT_PERMITTED', `Your role (${actor?.role}) may not reopen this ticket`);
    }

    return {
      ok: true,
      isReopen: true,
      isClose: false,
      // A Reopen out of the QA lane IS a rejection. A Reopen of something that
      // already shipped or closed is not — it is a regression or a revival.
      decision: QA_LANE_STAGES.includes(from) ? 'rejected' : null,
    };
  }

  if (!passes(toStage, actor, ticket)) {
    return refuse(
      'STAGE_NOT_PERMITTED',
      `Your role (${actor?.role}) may not move a ticket to ${toStage.label}`,
    );
  }

  return {
    ok: true,
    isReopen: false,
    isClose: to === 'closed',
    decision: to === 'qa_approved' ? 'approved' : null,
  };
}

/** What the client renders. The server re-checks every one of them. */
export function legalDestinations(from, actor, ticket) {
  return STAGE_KEYS.filter((key) => canTransition(from, key, actor, ticket).ok);
}
