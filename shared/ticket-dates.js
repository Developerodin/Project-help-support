export const RELEASE_BEFORE_RESOLUTION_MESSAGE =
  'Expected release cannot be before resolution estimate';

export const RESOLUTION_IN_PAST_MESSAGE =
  'Resolution estimate cannot be in the past';

export const RELEASE_IN_PAST_MESSAGE =
  'Expected release cannot be in the past';

/** @param {Date} [now] */
export function todayDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** @param {Date|string|null|undefined} value */
export function ticketDateKey(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Validate estimate dates. Cross-field ordering always applies when both are set.
 * Past-date checks apply only to fields listed in `changedFields` (new selections).
 * @param {Date|string|null|undefined} estimatedResolutionAt
 * @param {Date|string|null|undefined} expectedReleaseDate
 * @param {{ today?: string, changedFields?: string[] }} [options]
 * @returns {Record<string, string>|null}
 */
export function validateTicketEstimateDates(
  estimatedResolutionAt,
  expectedReleaseDate,
  options = {},
) {
  const today = options.today ?? todayDateKey();
  const changed = new Set(options.changedFields ?? []);
  const resolution = ticketDateKey(estimatedResolutionAt);
  const release = ticketDateKey(expectedReleaseDate);
  const errors = {};

  if (changed.has('estimatedResolutionAt') && resolution && resolution < today) {
    errors.estimatedResolutionAt = RESOLUTION_IN_PAST_MESSAGE;
  }
  if (changed.has('expectedReleaseDate') && release && release < today) {
    errors.expectedReleaseDate = RELEASE_IN_PAST_MESSAGE;
  }
  if (!errors.expectedReleaseDate && resolution && release && release < resolution) {
    errors.expectedReleaseDate = RELEASE_BEFORE_RESOLUTION_MESSAGE;
  }

  return Object.keys(errors).length ? errors : null;
}

/**
 * Merge persisted ticket dates with a patch body.
 * @param {{ estimatedResolutionAt?: Date|string|null, expectedReleaseDate?: Date|string|null }} ticket
 * @param {{ estimatedResolutionAt?: Date|string|null, expectedReleaseDate?: Date|string|null }} patch
 */
export function resolveTicketEstimateDates(ticket, patch = {}) {
  return {
    estimatedResolutionAt: 'estimatedResolutionAt' in patch
      ? patch.estimatedResolutionAt
      : ticket.estimatedResolutionAt,
    expectedReleaseDate: 'expectedReleaseDate' in patch
      ? patch.expectedReleaseDate
      : ticket.expectedReleaseDate,
  };
}

/** Calendar-day distance; positive when `to` is after `from`. */
export function daysBetweenDates(from, to = Date.now()) {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

/**
 * Matches backend overdue filter and frontend list chips: closed/live never overdue.
 * @param {{ estimatedResolutionAt?: Date|string|null, status?: string }} ticket
 * @param {number} [nowMs]
 */
export function isTicketOverdue(ticket, nowMs = Date.now()) {
  if (!ticket?.estimatedResolutionAt) return false;
  if (ticket.status === 'closed' || ticket.status === 'live') return false;
  return new Date(ticket.estimatedResolutionAt).getTime() < nowMs;
}

/** @param {Date|string|null|undefined} iso */
export function formatTicketDisplayDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Days since the ticket entered its current stage (minimum 0). */
export function ticketStageAgeDays(ticket, nowMs = Date.now()) {
  const entered = ticket?.currentStageEnteredAt
    || ticket?.stageHistory?.[ticket.stageHistory.length - 1]?.at
    || ticket?.updatedAt
    || ticket?.createdAt;
  if (!entered) return 0;
  return Math.max(0, daysBetweenDates(entered, nowMs));
}

