import { STAGE_KEYS } from './stages.js';

/** Stages external clients may see with their real key (close/reopen flows). */
export const EXTERNAL_NATIVE_STAGE_KEYS = Object.freeze(['live', 'closed']);

/**
 * Internal pipeline stages are collapsed to under_review in external responses
 * (display only — not used for list filtering).
 */
export const EXTERNAL_MASKED_AS_UNDER_REVIEW = Object.freeze(
  STAGE_KEYS.filter((key) => !EXTERNAL_NATIVE_STAGE_KEYS.includes(key)),
);

/** Stage filter options for external ticket lists. */
export const EXTERNAL_TICKET_FILTER_STAGES = Object.freeze([
  { key: 'under_review', label: 'Under Review' },
  { key: 'live', label: 'Live' },
  { key: 'closed', label: 'Closed' },
]);

/** Map a stored ticket status to the label external viewers should see. */
export function externalFacingTicketStatus(status) {
  if (!status || EXTERNAL_MASKED_AS_UNDER_REVIEW.includes(status)) return 'under_review';
  return status;
}

/** Exact stored status for external list filters (same semantics as internal users). */
export function ticketStatusesForExternalFilter(statusKey) {
  if (!statusKey) return null;
  return [statusKey];
}
