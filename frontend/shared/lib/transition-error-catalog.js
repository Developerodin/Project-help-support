/**
 * Transition and board-move error catalog — single source for severity, copy,
 * logging, and UI surface flags (banner vs toast vs silent).
 */

/** @typedef {'noop'|'info'|'validation'|'permission'|'conflict'|'system'} TransitionSeverity */
/** @typedef {'none'|'debug'|'error'} TransitionLogLevel */

/**
 * @typedef {object} TransitionErrorCatalogEntry
 * @property {TransitionSeverity} severity
 * @property {string|((ctx: object) => string)} title
 * @property {(ctx: object) => string} buildMessage
 * @property {string[]} resolutionSteps
 * @property {TransitionLogLevel} logLevel
 * @property {{ banner: boolean, toast: boolean, toastType?: 'info'|'error' }} surface
 * @property {'error'|'info'} [formVariant]
 */

const WITHIN_LANE_NOTE = 'To move between stages in the same lane, open the ticket and use the stage bar in Details.';

/** @type {Record<string, TransitionErrorCatalogEntry>} */
export const TRANSITION_ERROR_CATALOG = {
  SAME_STAGE: {
    severity: 'noop',
    title: 'No stage change',
    buildMessage: (ctx) => {
      const label = ctx.toLabel || ctx.stageLabel || 'that stage';
      return `This ticket is already in ${label}. Choose another lane, or open the ticket to pick a different stage within the lane.`;
    },
    resolutionSteps: [WITHIN_LANE_NOTE],
    logLevel: 'none',
    surface: { banner: false, toast: true, toastType: 'info' },
    formVariant: 'info',
  },
  TICKET_BLOCKED: {
    severity: 'info',
    title: 'Ticket is blocked',
    buildMessage: (ctx) => ctx.message
      || ctx.blockerReason
      || 'Clear the blocker on this ticket before changing its stage.',
    resolutionSteps: ['Open the ticket and clear the blocked status, or ask whoever blocked it.'],
    logLevel: 'none',
    surface: { banner: true, toast: false },
    formVariant: 'info',
  },
  OWNERSHIP_REQUIRED: {
    severity: 'validation',
    title: 'Assignment required',
    buildMessage: () => 'Assign a team or person before moving to Ready for QA.',
    resolutionSteps: ['Open Details and set Team or Assignee, then try again.'],
    logLevel: 'none',
    surface: { banner: true, toast: false },
  },
  ESTIMATES_REQUIRED: {
    severity: 'validation',
    title: 'Dates required',
    buildMessage: () => 'Add both dates in Details, save if needed, then try the stage change again.',
    resolutionSteps: ['Open Details and fill estimated resolution and expected release dates.'],
    logLevel: 'none',
    surface: { banner: false, toast: false },
  },
  INVALID_ESTIMATE_DATES: {
    severity: 'validation',
    title: 'Invalid dates',
    buildMessage: () => 'Expected release cannot be before resolution estimate.',
    resolutionSteps: ['Open Details and fix the date order, then try again.'],
    logLevel: 'none',
    surface: { banner: false, toast: false },
  },
  STAGE_CONFLICT: {
    severity: 'conflict',
    title: 'Ticket updated elsewhere',
    buildMessage: () => 'This ticket changed elsewhere — showing the latest version.',
    resolutionSteps: ['Review the updated ticket and try your move again if it still applies.'],
    logLevel: 'error',
    surface: { banner: false, toast: true, toastType: 'info' },
  },
  STALE_REVISION: {
    severity: 'conflict',
    title: 'Ticket updated elsewhere',
    buildMessage: () => 'This ticket changed elsewhere — showing the latest version.',
    resolutionSteps: ['Review the updated ticket and try your move again if it still applies.'],
    logLevel: 'error',
    surface: { banner: false, toast: true, toastType: 'info' },
  },
  CLIENT_BOARD_MOVE_FORBIDDEN: {
    severity: 'permission',
    title: 'Cannot move this ticket',
    buildMessage: (ctx) => ctx.message || 'You do not have permission to move this ticket on the board.',
    resolutionSteps: ['Clients can only close Live tickets.'],
    logLevel: 'none',
    surface: { banner: true, toast: false },
  },
  BOARD_OPERATE_FORBIDDEN: {
    severity: 'permission',
    title: 'Cannot move in this lane',
    buildMessage: (ctx) => ctx.message || 'Your role cannot move tickets in this lane.',
    resolutionSteps: ['Ask a teammate with operate or transition access on this board.'],
    logLevel: 'none',
    surface: { banner: true, toast: false },
  },
  NO_BOARD_PERMISSION: {
    severity: 'permission',
    title: 'Read-only board access',
    buildMessage: (ctx) => ctx.message || 'Your account has no board capabilities.',
    resolutionSteps: ['Open a ticket to view details, or ask an admin to configure board permissions.'],
    logLevel: 'none',
    surface: { banner: true, toast: false },
  },
  STAGE_NOT_PERMITTED: {
    severity: 'permission',
    title: 'Move not allowed',
    buildMessage: (ctx) => ctx.message || 'Your role cannot perform this stage change.',
    resolutionSteps: ['Check who can move tickets to this stage in board settings.'],
    logLevel: 'none',
    surface: { banner: true, toast: false },
  },
  ILLEGAL_BACKWARD: {
    severity: 'permission',
    title: 'Move not allowed',
    buildMessage: (ctx) => ctx.message || 'This backward move is not permitted from the board.',
    resolutionSteps: ['Use Reopen from the ticket drawer when QA sends work back.'],
    logLevel: 'none',
    surface: { banner: true, toast: false },
  },
  REOPEN_TOO_EARLY: {
    severity: 'permission',
    title: 'Reopen not available yet',
    buildMessage: (ctx) => ctx.message || 'Reopen is not available at this stage.',
    resolutionSteps: ['Move the ticket forward until it reaches Ready for QA or later.'],
    logLevel: 'none',
    surface: { banner: true, toast: false },
  },
  NOT_AUTHENTICATED: {
    severity: 'system',
    title: 'Sign in required',
    buildMessage: () => 'Sign in to move tickets on the board.',
    resolutionSteps: [],
    logLevel: 'error',
    surface: { banner: true, toast: false },
  },
};

export function lookupTransitionErrorCode(code) {
  if (!code) return null;
  return TRANSITION_ERROR_CATALOG[code] ?? null;
}

function resolveTitle(entry, ctx) {
  if (!entry) return ctx.title || null;
  const raw = entry.title;
  return typeof raw === 'function' ? raw(ctx) : raw;
}

/**
 * Board preflight block from getBoardMoveBlockReason / getBoardDragBlockReason.
 */
export function resolveBlockReasonDisplay(blockReason, extraCtx = {}) {
  if (!blockReason) return null;
  const code = blockReason.code;
  const entry = lookupTransitionErrorCode(code);
  const ctx = {
    ...blockReason,
    ...extraCtx,
    message: blockReason.message,
    fromLabel: blockReason.fromLabel,
    toLabel: blockReason.toLabel,
  };

  const title = blockReason.title || resolveTitle(entry, ctx) || 'Cannot move ticket';
  const message = entry?.buildMessage?.(ctx) ?? blockReason.message ?? 'This move is not allowed.';
  const severity = entry?.severity ?? 'permission';
  const formVariant = entry?.formVariant ?? (severity === 'info' || severity === 'noop' ? 'info' : 'error');

  return {
    code,
    title,
    message,
    severity,
    formVariant,
    logLevel: entry?.logLevel ?? (code?.startsWith('CLIENT_') || code?.startsWith('BOARD_') ? 'none' : 'error'),
    surface: entry?.surface ?? { banner: true, toast: false },
    resolutionSteps: entry?.resolutionSteps ?? [],
  };
}

/**
 * API / transition errors for banners and toasts.
 */
export function resolveApiErrorDisplay(normalized, extraCtx = {}) {
  if (!normalized) return null;
  const entry = lookupTransitionErrorCode(normalized.code);
  const ctx = { ...normalized, ...extraCtx };

  const title = resolveTitle(entry, ctx)
    || normalized.title
    || (normalized.status === 403 ? 'Permission denied' : 'Could not update ticket');
  const message = entry?.buildMessage?.(ctx) ?? normalized.message ?? 'Request failed';
  const severity = entry?.severity
    ?? (normalized.status === 409 ? 'conflict' : normalized.status >= 500 ? 'system' : 'system');
  const formVariant = entry?.formVariant ?? 'error';

  return {
    code: normalized.code,
    title,
    message,
    severity,
    formVariant,
    logLevel: entry?.logLevel ?? 'error',
    surface: entry?.surface ?? { banner: true, toast: false },
    resolutionSteps: entry?.resolutionSteps ?? [],
    requestId: normalized.requestId,
    fields: normalized.fields,
    status: normalized.status,
  };
}

export function catalogLogLevelForError(error) {
  const code = error?.code ?? error?.error?.code;
  const entry = lookupTransitionErrorCode(code);
  if (entry) return entry.logLevel;
  if (code && (code.startsWith('CLIENT_') || code.startsWith('BOARD_'))) return 'none';
  if (code === 'SAME_STAGE') return 'none';
  return null;
}
