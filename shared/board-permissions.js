import { ADMIN_ROLES, ROLE_IDS, ROLE_LABELS } from './enums.js';
import { can, isExternalUser, hasAnyRole } from './permissions.js';
import {
  canExternalCloseReopen,
  isPureExternalActor,
} from './board-role-policy.js';
import {
  canTransition,
  stageIndex,
  stageLabel,
  laneOf,
  laneEntryStage,
  LANES,
  REOPEN_TARGET,
} from './stages.js';
import {
  buildBoardRolePolicy,
  actorHasAnyBoardCapability,
  roleHasBoardCapability,
  resolveTransitionCapabilities,
  describeBoardPermittees,
  BOARD_LABELS,
  BOARD_CAPABILITY_LABELS,
} from './board-role-policy.js';

const CLIENT_STAGE_MOVE_HINT = 'Clients can only close Live tickets or reopen Closed tickets.';

function formatPermitteeList(parts) {
  const unique = [...new Set(parts.filter(Boolean))];
  if (unique.length === 0) return 'authorized roles';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} or ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, or ${unique.at(-1)}`;
}

/**
 * Describe who may move a ticket TO `stageKey` based on board-role policy.
 */
export function describeStagePermittees(stageKey, { forReopen = false, boardPolicy } = {}) {
  const policy = boardPolicy || buildBoardRolePolicy();
  const board = laneOf(stageKey);
  if (!board) return 'authorized roles';

  if (forReopen) {
    return formatPermitteeList([
      describeBoardPermittees('qa', 'qa_reject', policy),
      describeBoardPermittees('done', 'operate', policy),
    ]);
  }

  if (stageKey === 'qa_approved') {
    return describeBoardPermittees('qa', 'qa_approve', policy);
  }
  if (stageKey === 'closed') {
    return describeBoardPermittees('done', 'operate', policy);
  }

  return describeBoardPermittees(board, 'operate', policy);
}

/** Whether the user may drag cards or drop on lanes at all. */
export function canInteractWithBoard(
  actor,
  boardPolicy = buildBoardRolePolicy(),
  permissionContext = null,
) {
  if (!actor) return false;
  if (isPureExternalActor(actor)) return canExternalCloseReopen(actor, permissionContext);
  return actorHasAnyBoardCapability(actor, boardPolicy);
}

/** Whether this specific ticket card may be dragged. */
export function canDragTicket(
  actor,
  ticket,
  boardPolicy = buildBoardRolePolicy(),
  permissionContext = null,
) {
  if (!actor || !ticket) return false;
  if (isPureExternalActor(actor)) {
    if (!canExternalCloseReopen(actor, permissionContext)) return false;
    return ticket.status === 'live' || ticket.status === 'closed';
  }
  if (!canInteractWithBoard(actor, boardPolicy)) return false;
  // Draggable when the actor can operate on the ticket's current board.
  const board = laneOf(ticket.status);
  if (!board) return false;
  return roleHasBoardCapability(actor, board, 'operate', boardPolicy)
    || roleHasBoardCapability(actor, board, 'transition', boardPolicy);
}

function buildBlock(code, message, extra = {}) {
  return { code, message, ...extra };
}

function permitteeMessage(toStage, fromStatus, boardPolicy, forReopen = false) {
  const required = forReopen
    ? resolveTransitionCapabilities(fromStatus, REOPEN_TARGET)
    : resolveTransitionCapabilities(fromStatus, toStage);
  const parts = required.map(({ board, capability }) => (
    `${describeBoardPermittees(board, capability, boardPolicy)} (${BOARD_CAPABILITY_LABELS[capability] || capability} on ${BOARD_LABELS[board] || board})`
  ));
  return formatPermitteeList(parts);
}

/**
 * Preflight a board lane drop. Returns null when allowed, otherwise a display-ready error.
 */
export function getBoardMoveBlockReason(
  actor,
  ticket,
  toStage,
  boardPolicy = buildBoardRolePolicy(),
  permissionContext = null,
) {
  if (!actor) {
    return buildBlock('NOT_AUTHENTICATED', 'Sign in to move tickets on the board.');
  }

  const fromLabel = stageLabel(ticket?.status);
  const toLabel = stageLabel(toStage);
  const forReopen = stageIndex(toStage) < stageIndex(ticket?.status);
  const permittees = permitteeMessage(toStage, ticket?.status, boardPolicy, forReopen);

  if (isPureExternalActor(actor)) {
    const verdict = canTransition(
      ticket.status, toStage, actor, ticket, boardPolicy, permissionContext,
    );
    if (verdict.ok) return null;
    if (verdict.code !== 'STAGE_NOT_PERMITTED') {
      return buildBlock(verdict.code, verdict.reason || 'This move is not allowed.');
    }
    return buildBlock(
      'CLIENT_BOARD_MOVE_FORBIDDEN',
      `You don't have permission to move this ticket from ${fromLabel} to ${toLabel}. ${CLIENT_STAGE_MOVE_HINT}`,
      { permittees, fromLabel, toLabel },
    );
  }

  if (!canInteractWithBoard(actor, boardPolicy)) {
    const roleLabel = ROLE_LABELS[actor.role] || actor.role || 'your role';
    return buildBlock(
      'NO_BOARD_PERMISSION',
      `You don't have permission to move tickets. Your account (${roleLabel}) has no board capabilities configured.`,
      { permittees, fromLabel, toLabel },
    );
  }

  const verdict = canTransition(
    ticket.status, toStage, actor, ticket, boardPolicy, permissionContext,
  );
  if (!verdict.ok) {
    if (
      verdict.code === 'STAGE_NOT_PERMITTED'
      || verdict.code === 'ILLEGAL_BACKWARD'
      || verdict.code === 'REOPEN_TOO_EARLY'
    ) {
      return buildBlock(
        verdict.code,
        `You don't have permission to move this ticket from ${fromLabel} to ${toLabel}. Only ${permittees} can perform this step.`,
        { permittees, fromLabel, toLabel },
      );
    }
    return buildBlock(verdict.code, verdict.reason || 'This move is not allowed.');
  }

  return null;
}

/** Keyboard-move targets for a ticket card (lane label + destination stage). */
export function getBoardMoveTargets(
  actor,
  ticket,
  boardPolicy = buildBoardRolePolicy(),
  permissionContext = null,
) {
  if (!actor || !ticket) return [];

  const currentLane = laneOf(ticket.status);
  return LANES.map((lane) => {
    const to = laneEntryStage(lane.key);
    const sameLane = currentLane === lane.key;
    const block = sameLane ? null : getBoardMoveBlockReason(
      actor, ticket, to, boardPolicy, permissionContext,
    );
    return {
      laneKey: lane.key,
      label: lane.label,
      to,
      blocked: sameLane || Boolean(block),
    };
  });
}

export function getBoardDragBlockReason(
  actor,
  ticket,
  boardPolicy = buildBoardRolePolicy(),
  permissionContext = null,
) {
  if (!actor || !ticket) return null;

  if (isPureExternalActor(actor)) {
    if (!canExternalCloseReopen(actor, permissionContext)) {
      return buildBlock(
        'CLIENT_BOARD_MOVE_FORBIDDEN',
        'Your role cannot close or reopen tickets.',
      );
    }
    if (ticket.status === 'live' || ticket.status === 'closed') return null;
    return buildBlock(
      'CLIENT_BOARD_MOVE_FORBIDDEN',
      `You don't have permission to move this ticket from ${stageLabel(ticket.status)}. ${CLIENT_STAGE_MOVE_HINT}`,
    );
  }

  const readOnly = getBoardReadOnlyNotice(actor, boardPolicy);
  if (readOnly) return readOnly;

  if (!canDragTicket(actor, ticket, boardPolicy)) {
    const board = laneOf(ticket.status);
    const boardLabel = BOARD_LABELS[board] || board;
    return buildBlock(
      'BOARD_OPERATE_FORBIDDEN',
      `You don't have permission to move tickets in ${boardLabel}. Your role lacks operate or transition capability on this board.`,
    );
  }

  return null;
}

/** Persistent notice for users who cannot interact with the board. */
export function getBoardReadOnlyNotice(actor, boardPolicy = buildBoardRolePolicy()) {
  if (!actor) return null;
  if (isExternalUser(actor)) return null;

  if (!canInteractWithBoard(actor, boardPolicy)) {
    const roleLabel = ROLE_LABELS[actor.role] || actor.role || 'your role';
    return {
      code: 'NO_BOARD_PERMISSION',
      title: 'Read-only board access',
      message: `Your account (${roleLabel}) has no board capabilities. Open a ticket to view details, or ask an admin to configure board permissions.`,
    };
  }

  return null;
}

const idOf = (value) => (value == null ? '' : String(value._id ?? value.id ?? value));

/** Client-side mirror of backend assertCanEditTicket (non-board ticket edits). */
export function canEditTicket(actor, ticket) {
  if (!actor || !ticket) return false;

  const privileged = hasAnyRole(actor, ...ADMIN_ROLES, ROLE_IDS.PROJECT_ADMIN);
  const actorId = idOf(actor);
  const createdById = idOf(ticket.createdBy);
  const assignedToId = idOf(ticket.assignedTo);

  return privileged || (actorId && (actorId === createdById || actorId === assignedToId));
}
