import {
  buildTicketListSortBy,
  DEFAULT_TICKET_PREFERENCES,
  mergeTicketPreferences,
} from '@pms/shared';

export function buildTicketListQuery({
  preferences,
  projectId,
  page = 1,
  scopeOverride,
} = {}) {
  const prefs = mergeTicketPreferences(preferences);
  const { filters, sort, limit } = prefs;
  const query = {
    page,
    limit,
    project: projectId || undefined,
  };

  if (filters.q) query.q = filters.q;
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

export { DEFAULT_TICKET_PREFERENCES, mergeTicketPreferences };
