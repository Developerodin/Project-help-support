export const TICKET_SORT_COLUMNS = Object.freeze([
  'ticketId',
  'title',
  'status',
  'owner',
  'inStage',
  'estimatedDone',
]);

export const TICKET_SCOPES = Object.freeze(['all', 'assigned', 'reported', 'unassigned']);

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

export function hasActiveTicketFilters(filters = {}) {
  const defaults = DEFAULT_TICKET_PREFERENCES.filters;
  return (
    Boolean(filters.q)
    || Boolean(filters.status)
    || Boolean(filters.priority)
    || (filters.scope && filters.scope !== defaults.scope)
    || Boolean(filters.assignedTo)
    || Boolean(filters.blocked)
    || Boolean(filters.overdue)
    || Boolean(filters.reopened)
  );
}

export function hasTicketPreferenceChanges(preferences = {}) {
  const current = mergeTicketPreferences(preferences);
  const defaults = DEFAULT_TICKET_PREFERENCES;
  return hasActiveTicketFilters(current.filters)
    || current.sort.column !== defaults.sort.column
    || current.sort.direction !== defaults.sort.direction
    || current.boardMine !== defaults.boardMine;
}
