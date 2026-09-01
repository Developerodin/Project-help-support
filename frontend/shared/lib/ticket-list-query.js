import {
  buildTicketListSortBy,
  DEFAULT_TICKET_PREFERENCES,
  mergeTicketPreferences,
} from '@pms/shared';

export function buildTicketListQuery({
  preferences,
  projectId,
  page = 1,
  limitOverride,
  scopeOverride,
  qOverride,
} = {}) {
  const prefs = mergeTicketPreferences(preferences);
  const { filters, sort, limit } = prefs;
  const query = {
    page,
    limit: limitOverride ?? limit,
    project: projectId || undefined,
  };

  // The live term drives the input; the debounced one drives the request.
  const q = qOverride ?? filters.q;
  if (q) query.q = q;
  if (filters.status) query.status = filters.status;
  if (filters.priority) query.priority = filters.priority;
  const scope = scopeOverride ?? filters.scope;
  if (scope && scope !== 'all') query.scope = scope;
  if (filters.assignedTo) query.assignedTo = filters.assignedTo;
  if (filters.blocked) query.blocked = true;
  if (filters.overdue) query.overdue = true;
  if (filters.reopened) query.reopened = true;

  const sortBy = buildTicketListSortBy(sort);
  if (sortBy) query.sortBy = sortBy;

  return query;
}

export function preferencesFromUser(user) {
  return mergeTicketPreferences(user?.ticketPreferences);
}

export function clampTicketListPage(requestedPage, totalPages) {
  const pages = Math.max(1, Number(totalPages) || 1);
  const page = Math.max(1, Number(requestedPage) || 1);
  return Math.min(page, pages);
}

/**
 * Owner options are derived per project, but the owner filter is persisted per
 * user — so a value outlives the project it came from and the <select> falls
 * back to rendering "Any owner" while the query still filters by it.
 *
 * `ownerIds === null` means the option set has not resolved (or the lookup
 * failed): unknown is not the same as empty, and clearing on unknown would
 * wipe a legitimate filter on every load.
 *
 * @returns a filter patch to apply, or null when nothing is stale.
 */
export function staleProjectFilters(filters = {}, { ownerIds } = {}) {
  if (!ownerIds) return null;
  if (!filters.assignedTo) return null;
  if (ownerIds.includes(filters.assignedTo)) return null;
  return { assignedTo: '' };
}

/** Page sizes the picker offers. The API caps limit at 100. */
export const TICKET_PAGE_SIZES = Object.freeze([25, 50, 100]);

export const TICKET_PAGE_PARAM = 'page';
export const TICKET_LIMIT_PARAM = 'limit';

export function pageFromSearch(search) {
  const raw = Number.parseInt(new URLSearchParams(search).get(TICKET_PAGE_PARAM), 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 1;
}

export function limitFromSearch(search, fallback) {
  const safeFallback = TICKET_PAGE_SIZES.includes(fallback) ? fallback : TICKET_PAGE_SIZES[0];
  const raw = Number.parseInt(new URLSearchParams(search).get(TICKET_LIMIT_PARAM), 10);
  return TICKET_PAGE_SIZES.includes(raw) ? raw : safeFallback;
}

/**
 * The filter keys the URL carries. Flags ride as '1' so the URL only ever
 * names a filter that is actually on.
 */
const URL_FILTER_KEYS = Object.freeze(['q', 'status', 'priority', 'scope', 'assignedTo']);
const URL_FLAG_KEYS = Object.freeze(['blocked', 'overdue', 'reopened']);

export function hasFilterParams(search) {
  const params = new URLSearchParams(search);
  return [...URL_FILTER_KEYS, ...URL_FLAG_KEYS].some((key) => params.has(key));
}

/** Every filter, read from the URL. Anything the URL does not name is default. */
export function filtersFromSearch(search) {
  const params = new URLSearchParams(search);
  const filters = { ...DEFAULT_TICKET_PREFERENCES.filters };
  for (const key of URL_FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  for (const key of URL_FLAG_KEYS) filters[key] = params.get(key) === '1';
  return filters;
}

/** Rewrites the filter params in place, leaving ticket/limit/page alone. */
export function withFilterParams(search, filters = {}) {
  const merged = { ...DEFAULT_TICKET_PREFERENCES.filters, ...filters };
  const defaults = DEFAULT_TICKET_PREFERENCES.filters;
  const params = new URLSearchParams(search);

  for (const key of URL_FILTER_KEYS) {
    if (merged[key] && merged[key] !== defaults[key]) params.set(key, merged[key]);
    else params.delete(key);
  }
  for (const key of URL_FLAG_KEYS) {
    if (merged[key]) params.set(key, '1');
    else params.delete(key);
  }

  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/**
 * The URL is the current view; saved preferences are only the default it starts
 * from. A URL that names any filter is authoritative for ALL of them — merging
 * the two would show a shared link's recipient a view its sender never had.
 */
export function resolveViewFilters(search, preferences) {
  if (hasFilterParams(search)) return filtersFromSearch(search);
  return mergeTicketPreferences(preferences).filters;
}

/** Page 1 is the default view, so it stays out of the URL. */
export function withPageParam(search, page) {
  const params = new URLSearchParams(search);
  if (page > 1) params.set(TICKET_PAGE_PARAM, String(page));
  else params.delete(TICKET_PAGE_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

export { DEFAULT_TICKET_PREFERENCES, mergeTicketPreferences };
