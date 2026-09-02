export const TICKET_SORT_COLUMNS = Object.freeze([
  'ticketId',
  'title',
  'status',
  'owner',
  'inStage',
  'estimatedDone',
]);

import { isExternalUser } from './permissions.js';

export const TICKET_SCOPES = Object.freeze(['all', 'assigned', 'reported', 'unassigned']);

/** Default stage filter for external ticket lists (not live/closed). */
export const EXTERNAL_DEFAULT_TICKET_FILTER_STATUS = 'under_review';

export const DEFAULT_TICKET_PREFERENCES = Object.freeze({
  filters: Object.freeze({
    q: '',
    status: '',
    priority: '',
    scope: 'all',
    assignedTo: '',
    blocked: false,
    overdue: false,
    reopened: false,
  }),
  sort: Object.freeze({
    column: 'ticketId',
    direction: 'desc',
  }),
  boardMine: false,
  limit: 25,
});

export function mergeTicketPreferences(stored = {}) {
  const filters = { ...DEFAULT_TICKET_PREFERENCES.filters, ...(stored.filters || {}) };
  const sort = { ...DEFAULT_TICKET_PREFERENCES.sort, ...(stored.sort || {}) };
  return {
    filters,
    sort,
    boardMine: stored.boardMine ?? DEFAULT_TICKET_PREFERENCES.boardMine,
    limit: stored.limit ?? DEFAULT_TICKET_PREFERENCES.limit,
  };
}

/** Role-aware defaults — external users start filtered to Under Review. */
export function defaultTicketPreferencesForUser(user) {
  if (!isExternalUser(user)) return DEFAULT_TICKET_PREFERENCES;
  return mergeTicketPreferences({
    filters: { status: EXTERNAL_DEFAULT_TICKET_FILTER_STATUS },
  });
}

/** Apply role defaults; only fill an empty stage filter for external users. */
export function normalizeTicketPreferencesForUser(user, stored = {}) {
  const roleDefaults = defaultTicketPreferencesForUser(user);
  const merged = mergeTicketPreferences({
    ...roleDefaults,
    ...stored,
    filters: { ...roleDefaults.filters, ...(stored.filters || {}) },
    sort: { ...(stored.sort || {}) },
  });
  if (!isExternalUser(user) || merged.filters.status) return merged;
  return {
    ...merged,
    filters: { ...merged.filters, status: EXTERNAL_DEFAULT_TICKET_FILTER_STATUS },
  };
}

const SORT_FIELD_MAP = Object.freeze({
  ticketId: 'ticketId',
  title: 'title',
  status: 'status',
  owner: 'assignedTo',
  inStage: 'updatedAt',
  estimatedDone: 'estimatedResolutionAt',
});

export function buildTicketListSortBy(sort) {
  if (!sort?.column || !sort?.direction) return undefined;
  const field = SORT_FIELD_MAP[sort.column];
  if (!field) return undefined;
  return `${field}:${sort.direction}`;
}

export function cycleTicketSort(current, column) {
  if (current?.column !== column) {
    return { column, direction: 'desc' };
  }
  if (current.direction === 'desc') return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column: null, direction: null };
  return { column, direction: 'desc' };
}

export function sortAriaValue(sort, column) {
  if (sort?.column !== column || !sort?.direction) return undefined;
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

export function hasActiveTicketFilters(filters = {}, defaults = DEFAULT_TICKET_PREFERENCES.filters) {
  return (
    Boolean(filters.q)
    || (Boolean(filters.status) && filters.status !== defaults.status)
    || Boolean(filters.priority)
    || (filters.scope && filters.scope !== defaults.scope)
    || Boolean(filters.assignedTo)
    || Boolean(filters.blocked)
    || Boolean(filters.overdue)
    || Boolean(filters.reopened)
  );
}

export function hasTicketPreferenceChanges(preferences = {}, user) {
  const current = mergeTicketPreferences(preferences);
  const defaults = defaultTicketPreferencesForUser(user);
  return hasActiveTicketFilters(current.filters, defaults.filters)
    || current.sort.column !== defaults.sort.column
    || current.sort.direction !== defaults.sort.direction
    || current.boardMine !== defaults.boardMine;
}
