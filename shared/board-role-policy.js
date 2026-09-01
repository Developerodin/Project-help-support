import { ROLE_IDS, ROLE_LABELS } from './enums.js';
import { getUserRoles, hasAnyRole, isExternalUser } from './permissions.js';
import { userHasEffectivePermission } from './permission-resolution.js';
import { MATRIX_ROLES } from './permission-resolution.js';
import {
  STAGE_BY_KEY,
  stageIndex,
  stageLabel,
  laneOf,
  REOPEN_TARGET,
  REOPEN_MIN_INDEX,
  QA_LANE_STAGES,
  isQaRejection,
} from './stages.js';

/** Board lanes aligned with LANES in stages.js. */
export const BOARD_KEYS = Object.freeze(['intake', 'development', 'qa', 'release', 'done']);

export const BOARD_LABELS = Object.freeze({
  intake: 'Intake',
  development: 'Development',
  qa: 'QA',
  release: 'Release',
  done: 'Done',
});

/** Capabilities governing board flow and QA actions. */
export const BOARD_CAPABILITIES = Object.freeze([
  'operate',
  'transition',
  'qa_approve',
  'qa_reject',
]);

export const BOARD_CAPABILITY_LABELS = Object.freeze({
  operate: 'Operate on board',
  transition: 'Transition to next board',
  qa_approve: 'QA approve',
  qa_reject: 'QA reject',
});

/** QA-only capabilities — only meaningful on the QA board. */
export const QA_BOARD_CAPABILITIES = Object.freeze(['qa_approve', 'qa_reject']);

const ALL_BOARDS = [...BOARD_KEYS];
const FULL_CAPS = [...BOARD_CAPABILITIES];

function capsFor(...names) {
  return [...names];
}

function boardGrants(...entries) {
  return Object.fromEntries(entries);
}

/**
 * Safe defaults derived from the legacy stage gate roles. Relationship-based
 * gates (assignee/reporter) are intentionally NOT carried over — board flow is
 * role-only.
 */
export const DEFAULT_BOARD_ROLE_POLICY = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: boardGrants(
    ...ALL_BOARDS.map((board) => [board, FULL_CAPS]),
  ),
  [ROLE_IDS.ADMIN]: boardGrants(
    ...ALL_BOARDS.map((board) => [board, FULL_CAPS]),
  ),
  [ROLE_IDS.PROJECT_ADMIN]: boardGrants(
    ['intake', capsFor('operate', 'transition')],
    ['development', capsFor('operate', 'transition')],
    ['qa', capsFor('operate', 'transition')],
    ['release', capsFor('operate', 'transition')],
    ['done', capsFor('operate', 'transition')],
  ),
  [ROLE_IDS.DEVELOPER]: boardGrants(
    ['development', capsFor('operate', 'transition')],
    ['qa', capsFor('operate')],
    ['done', capsFor('operate', 'transition')],
  ),
  [ROLE_IDS.TESTER]: boardGrants(
    ['qa', FULL_CAPS],
  ),
  [ROLE_IDS.SUPPORT]: boardGrants(),
  [ROLE_IDS.READ_ONLY]: boardGrants(),
  [ROLE_IDS.CLIENT]: boardGrants(),
  [ROLE_IDS.CLIENT_TESTER]: boardGrants(),
});

function assertKnownBoard(board) {
  if (!BOARD_KEYS.includes(board)) throw new Error(`Unknown board: ${board}`);
}

function assertKnownCapability(capability) {
  if (!BOARD_CAPABILITIES.includes(capability)) {
    throw new Error(`Unknown board capability: ${capability}`);
  }
}

function assertKnownRole(role) {
  if (!MATRIX_ROLES.includes(role)) throw new Error(`Unknown matrix role: ${role}`);
}

/** Build role→board→Set map from a policy-shaped source. */
export function buildBoardRolePolicy(source = DEFAULT_BOARD_ROLE_POLICY) {
  const policy = {};
  for (const role of MATRIX_ROLES) {
    const boards = source[role] || {};
    policy[role] = {};
    for (const board of BOARD_KEYS) {
      const caps = boards[board] || [];
      for (const cap of caps) assertKnownCapability(cap);
      policy[role][board] = new Set(caps);
    }
  }
  return policy;
}

export function cloneBoardRolePolicy(policy) {
  const clone = {};
  for (const role of MATRIX_ROLES) {
    clone[role] = {};
    for (const board of BOARD_KEYS) {
      clone[role][board] = new Set(policy[role]?.[board] || []);
    }
  }
  return clone;
}

export function boardPolicyToRecord(policy) {
  const record = {};
  for (const role of MATRIX_ROLES) {
    record[role] = {};
    for (const board of BOARD_KEYS) {
      record[role][board] = [...(policy[role]?.[board] || [])].sort();
    }
  }
  return record;
}

export function recordToBoardPolicy(record) {
  const policy = {};
  for (const role of MATRIX_ROLES) {
    assertKnownRole(role);
    policy[role] = {};
    const boards = record[role] || {};
    for (const board of BOARD_KEYS) {
      assertKnownBoard(board);
      const caps = boards[board] || [];
      for (const cap of caps) assertKnownCapability(cap);
      policy[role][board] = new Set(caps);
    }
  }
  return policy;
}

export function policyHasCapability(policy, role, board, capability) {
  return policy[role]?.[board]?.has(capability) ?? false;
}

/** Legacy stage-gate role strings → ROLE_IDS (test + migration compat). */
const BOARD_ROLE_ALIASES = Object.freeze({
  qa: ROLE_IDS.TESTER,
  lead: ROLE_IDS.PROJECT_ADMIN,
  admin: ROLE_IDS.ADMIN,
});

function resolveActorRoles(actor) {
  const roles = getUserRoles(actor);
  const expanded = new Set(roles);
  for (const role of roles) {
    const alias = BOARD_ROLE_ALIASES[role];
    if (alias) expanded.add(alias);
  }
  return [...expanded];
}

/** True when any of the actor's roles grants the capability on the board. */
export function roleHasBoardCapability(actor, board, capability, policy) {
  assertKnownBoard(board);
  assertKnownCapability(capability);
  if (!actor) return false;
  const roles = resolveActorRoles(actor);
  return roles.some((role) => policyHasCapability(policy, role, board, capability));
}

/** True when the actor may interact with at least one board. */
export function actorHasAnyBoardCapability(actor, policy) {
  if (!actor) return false;
  if (isExternalUser(actor)) return true;
  const roles = resolveActorRoles(actor);
  for (const role of roles) {
    for (const board of BOARD_KEYS) {
      for (const cap of BOARD_CAPABILITIES) {
        if (policyHasCapability(policy, role, board, cap)) return true;
      }
    }
  }
  return false;
}

/**
 * Resolve which board capabilities are required for a transition.
 * Returns an array of { board, capability } — all must pass (deny-by-default).
 */
export function resolveTransitionCapabilities(from, to) {
  const fromBoard = laneOf(from);
  const toBoard = laneOf(to);
  const fromStage = STAGE_BY_KEY.get(from);
  const toStage = STAGE_BY_KEY.get(to);
  if (!fromStage || !toStage) return [];

  const isBackward = toStage.index < fromStage.index;

  if (isBackward) {
    if (isQaRejection(from)) return [{ board: 'qa', capability: 'qa_reject' }];
    if (fromBoard === 'done') return [{ board: 'done', capability: 'operate' }];
    return [{ board: fromBoard, capability: 'operate' }];
  }

  if (to === 'qa_approved') return [{ board: 'qa', capability: 'qa_approve' }];

  if (to === 'closed') return [{ board: 'done', capability: 'operate' }];

  if (fromBoard === toBoard) return [{ board: fromBoard, capability: 'operate' }];

  return [
    { board: fromBoard, capability: 'transition' },
    { board: toBoard, capability: 'operate' },
  ];
}

const refuse = (code, reason) => ({ ok: false, code, reason });

export const EXTERNAL_ACCEPTANCE_PERMISSION = 'tickets.accept';

const PURE_EXTERNAL_INTERNAL_ROLES = [
  ROLE_IDS.SUPER_ADMIN,
  ROLE_IDS.ADMIN,
  ROLE_IDS.PROJECT_ADMIN,
  ROLE_IDS.DEVELOPER,
  ROLE_IDS.TESTER,
  ROLE_IDS.SUPPORT,
  ROLE_IDS.READ_ONLY,
];

/** External role without any internal role — close/reopen is permission-gated. */
export function isPureExternalActor(actor) {
  return isExternalUser(actor) && !hasAnyRole(actor, ...PURE_EXTERNAL_INTERNAL_ROLES);
}

export function canExternalCloseReopen(actor, permissionContext = null) {
  if (!actor) return false;
  if (!isPureExternalActor(actor)) return false;
  return userHasEffectivePermission(
    actor,
    EXTERNAL_ACCEPTANCE_PERMISSION,
    permissionContext || {},
  );
}

/**
 * Role-based board permission check for transitions. External-user carve-out
 * matches stages.js; internal users are gated solely by board policy.
 */
export function canBoardTransition(
  from,
  to,
  actor,
  ticket,
  policy = buildBoardRolePolicy(),
  permissionContext = null,
) {
  const fromStage = STAGE_BY_KEY.get(from);
  const toStage = STAGE_BY_KEY.get(to);

  if (!fromStage) return refuse('UNKNOWN_STAGE', `"${from}" is not a stage`);
  if (!toStage) return refuse('UNKNOWN_STAGE', `"${to}" is not a stage`);
  if (fromStage.index === toStage.index) {
    return refuse('SAME_STAGE', `The ticket is already in ${toStage.label}`);
  }

  if (isPureExternalActor(actor)) {
    if (!canExternalCloseReopen(actor, permissionContext)) {
      return refuse(
        'STAGE_NOT_PERMITTED',
        'Your role cannot close or reopen tickets',
      );
    }
    if (from === 'live' && to === 'closed') {
      return { ok: true, isReopen: false, isClose: true, decision: null };
    }
    if (from === 'closed' && to === REOPEN_TARGET) {
      return { ok: true, isReopen: true, isClose: false, decision: null };
    }
    return refuse(
      'STAGE_NOT_PERMITTED',
      `Clients may only move Live tickets to Closed, or reopen Closed tickets to ${stageLabel(REOPEN_TARGET)}`,
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
  }

  const required = resolveTransitionCapabilities(from, to);
  const allowed = required.length === 0
    || required.every(({ board, capability }) => roleHasBoardCapability(actor, board, capability, policy));
  if (!allowed) {
    const roleLabel = ROLE_LABELS[actor?.role] || actor?.role || 'your role';
    const missing = required.find(
      ({ board, capability }) => !roleHasBoardCapability(actor, board, capability, policy),
    ) || required[0];
    const capLabel = BOARD_CAPABILITY_LABELS[missing.capability] || missing.capability;
    const boardLabel = BOARD_LABELS[missing.board] || missing.board;
    return refuse(
      'STAGE_NOT_PERMITTED',
      `Your role (${roleLabel}) lacks ${capLabel.toLowerCase()} on ${boardLabel} to move a ticket to ${toStage.label}`,
    );
  }

  return {
    ok: true,
    isReopen,
    isClose: to === 'closed',
    decision: isReopen
      ? (QA_LANE_STAGES.includes(from) ? 'rejected' : null)
      : (to === 'qa_approved' ? 'approved' : null),
  };
}

/** Roles that grant a capability on a board — for UI permittee messaging. */
export function describeBoardPermittees(board, capability, policy = buildBoardRolePolicy()) {
  const roles = MATRIX_ROLES.filter(
    (role) => policyHasCapability(policy, role, board, capability),
  );
  const labels = roles.map((role) => ROLE_LABELS[role] || role);
  if (labels.length === 0) return 'authorized roles';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, or ${labels.at(-1)}`;
}

export function diffBoardPolicies(fromPolicy, toPolicy) {
  const changes = [];
  for (const role of MATRIX_ROLES) {
    for (const board of BOARD_KEYS) {
      for (const capability of BOARD_CAPABILITIES) {
        const before = policyHasCapability(fromPolicy, role, board, capability);
        const after = policyHasCapability(toPolicy, role, board, capability);
        if (before === after) continue;
        changes.push({ role, board, capability, before, after });
      }
    }
  }
  return changes;
}
