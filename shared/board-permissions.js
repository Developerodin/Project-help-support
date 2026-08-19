import { ADMIN_ROLES, ROLE_IDS, ROLE_LABELS } from './enums.js';
import { can, isExternalUser, hasAnyRole } from './permissions.js';
import {
  canTransition,
  stageIndex,
  stageLabel,
  STAGE_BY_KEY,
  REOPEN_ROLES,
  REOPEN_RELATIONSHIPS,
} from './stages.js';

/** Human labels for stage gate roles (distinct from global ROLE_IDS). */
export const STAGE_ROLE_LABELS = Object.freeze({
  admin: 'Admin',
  lead: 'Project Admin',
  qa: 'Tester',
  assignee: 'the assignee',
  reporter: 'the reporter',
});

function formatPermitteeList(parts) {
  const unique = [...new Set(parts.filter(Boolean))];
  if (unique.length === 0) return 'someone who can edit this ticket';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} or ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, or ${unique.at(-1)}`;
}

/**
 * Describe who may move a ticket TO `stageKey` based on shared stage gate metadata.
 * Used for permission-aware board and drawer messaging.
 */
export function describeStagePermittees(stageKey, { forReopen = false } = {}) {
  if (forReopen) {
    const parts = [
      ...REOPEN_ROLES.map((role) => STAGE_ROLE_LABELS[role] || role),
      ...REOPEN_RELATIONSHIPS.map((rel) => STAGE_ROLE_LABELS[rel] || rel),
    ];
    return formatPermitteeList(parts);
  }

  const stage = STAGE_BY_KEY.get(stageKey);
  if (!stage) return 'authorized users';

  const parts = [
    ...stage.roles.map((role) => STAGE_ROLE_LABELS[role] || role),
    ...stage.relationships.map((rel) => STAGE_ROLE_LABELS[rel] || rel),
  ];
  return formatPermitteeList(parts);
}

/**
 * Normalize a populated reference OR a raw id into a comparable string.
 * Mirrors backend sameId — createdBy/assignedTo may arrive un-populated (a
 * raw ObjectId/string) depending on the query, and `.id`/`._id` on a raw
 * string is always undefined, so a naive lookup silently drops ownership.
 */
const idOf = (value) => (value == null ? '' : String(value._id ?? value.id ?? value));

/** Client-side mirror of backend assertCanEditTicket. */
export function canEditTicket(actor, ticket) {
  if (!actor || !ticket) return false;

  const privileged = hasAnyRole(actor, ...ADMIN_ROLES, ROLE_IDS.PROJECT_ADMIN);
  const actorId = idOf(actor);
  const createdById = idOf(ticket.createdBy);
  const assignedToId = idOf(ticket.assignedTo);

  return privileged || (actorId && (actorId === createdById || actorId === assignedToId));
}

/** Whether the user may drag cards or drop on lanes at all. */
export function canInteractWithBoard(actor) {
  if (!actor) return false;
  if (isExternalUser(actor)) return true;
  return can(actor, 'tickets.update');
}

/** Whether this specific ticket card may be dragged. */
export function canDragTicket(actor, ticket) {
  if (!actor || !ticket) return false;
  if (isExternalUser(actor)) return ticket.status === 'live';
  return canInteractWithBoard(actor) && canEditTicket(actor, ticket);
}

function buildBlock(code, message, extra = {}) {
  return { code, message, ...extra };
}

/**
 * Preflight a board lane drop. Returns null when allowed, otherwise a display-ready error.
 * Validation guards (dates, ownership) are intentionally excluded — those still come from the API.
 */
export function getBoardMoveBlockReason(actor, ticket, toStage) {
  if (!actor) {
    return buildBlock('NOT_AUTHENTICATED', 'Sign in to move tickets on the board.');
  }

  const fromLabel = stageLabel(ticket?.status);
  const toLabel = stageLabel(toStage);
  const permittees = describeStagePermittees(
    toStage,
    { forReopen: stageIndex(toStage) < stageIndex(ticket?.status) },
  );

  if (isExternalUser(actor)) {
    if (ticket?.status === 'live' && toStage === 'closed') {
      const verdict = canTransition(ticket.status, toStage, actor, ticket);
      if (!verdict.ok) {
        return buildBlock(verdict.code, verdict.reason || 'This move is not allowed.');
      }
      return null;
    }

    return buildBlock(
      'CLIENT_BOARD_MOVE_FORBIDDEN',
      `You don't have permission to move this ticket from ${fromLabel} to ${toLabel}. Clients can only close tickets that are Live.`,
      { permittees, fromLabel, toLabel },
    );
  }

  if (!can(actor, 'tickets.update')) {
    const roleLabel = ROLE_LABELS[actor.role] || actor.role || 'your role';
    return buildBlock(
      'NO_UPDATE_PERMISSION',
      `You don't have permission to move tickets. Your account (${roleLabel}) is read-only on the board. Only ${permittees} can move tickets from ${fromLabel} to ${toLabel}.`,
      { permittees, fromLabel, toLabel },
    );
  }

  if (!canEditTicket(actor, ticket)) {
    return buildBlock(
      'TICKET_EDIT_FORBIDDEN',
      `You don't have permission to move this ticket. Only the reporter, assignee, Project Admin, or Admin can change its stage. To move from ${fromLabel} to ${toLabel}, ${permittees} can perform this step.`,
      { permittees, fromLabel, toLabel },
    );
  }

  const verdict = canTransition(ticket.status, toStage, actor, ticket);
  if (!verdict.ok) {
    if (
      verdict.code === 'STAGE_NOT_PERMITTED'
      || verdict.code === 'ILLEGAL_BACKWARD'
      || verdict.code === 'REOPEN_TOO_EARLY'
    ) {
      return buildBlock(
        verdict.code,
        `You don't have permission to move this ticket from ${fromLabel} to ${toLabel}. Only ${permittees} can move tickets to ${toLabel}.`,
        { permittees, fromLabel, toLabel },
      );
    }

    return buildBlock(verdict.code, verdict.reason || 'This move is not allowed.');
  }

  return null;
}

/**
 * Explain why a card cannot even be picked up for dragging — called from
 * onDragStart, before any drop target/lane is known. Distinct from
 * getBoardMoveBlockReason, which explains a specific attempted move once a
 * `toStage` is known; this is the single shared source for the "why can't I
 * drag this at all" strings, so callers never hand-roll a near-duplicate.
 */
export function getBoardDragBlockReason(actor, ticket) {
  if (!actor || !ticket) return null;

  if (isExternalUser(actor)) {
    if (ticket.status === 'live') return null;
    return buildBlock(
      'CLIENT_BOARD_MOVE_FORBIDDEN',
      `You don't have permission to move this ticket from ${stageLabel(ticket.status)}. Clients can only close tickets that are Live.`,
    );
  }

  const readOnly = getBoardReadOnlyNotice(actor);
  if (readOnly) return readOnly;

  if (!canEditTicket(actor, ticket)) {
    return buildBlock(
      'TICKET_EDIT_FORBIDDEN',
      'You don\'t have permission to move this ticket. Only the reporter, assignee, Project Admin, or Admin can change its stage.',
    );
  }

  return null;
}

/** Persistent notice for users who cannot interact with the board. */
export function getBoardReadOnlyNotice(actor) {
  if (!actor) return null;

  if (isExternalUser(actor)) return null;

  if (!can(actor, 'tickets.update')) {
    const roleLabel = ROLE_LABELS[actor.role] || actor.role || 'your role';
    return {
      code: 'NO_UPDATE_PERMISSION',
      title: 'Read-only board access',
      message: `Your account (${roleLabel}) cannot move tickets on the board. Open a ticket to view details, or ask a Project Admin if a stage change is needed.`,
    };
  }

  return null;
}
