/** Page sizes the picker offers. The API caps limit at 100. */
export const AUDIT_PAGE_SIZES = Object.freeze([20, 50, 100]);
export const DEFAULT_AUDIT_LIMIT = 50;
export const AUDIT_SORTS = Object.freeze(['createdAt:desc', 'createdAt:asc']);
export const DEFAULT_AUDIT_SORT = 'createdAt:desc';
export const AUDIT_CATEGORIES = Object.freeze(['policy', 'access', 'security', 'whatsapp', 'ticket']);

export const DEFAULT_AUDIT_QUERY = Object.freeze({
  page: 1,
  limit: DEFAULT_AUDIT_LIMIT,
  category: '',
  action: '',
  actorId: '',
  targetUserId: '',
  sortBy: DEFAULT_AUDIT_SORT,
});

export const CLEARED_AUDIT_FILTERS = Object.freeze({
  category: '', action: '', actorId: '', targetUserId: '',
});

/** Any of these changing means the current page number no longer points at the same rows. */
const PAGE_RESET_KEYS = ['category', 'action', 'actorId', 'targetUserId', 'sortBy', 'limit'];

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export function auditQueryFromSearch(search) {
  const params = new URLSearchParams(search);
  const rawPage = Number.parseInt(params.get('page'), 10);
  const rawLimit = Number.parseInt(params.get('limit'), 10);
  const category = params.get('category') || '';
  const actorId = (params.get('actorId') || '').trim();
  const targetUserId = (params.get('targetUserId') || '').trim();
  const sortBy = params.get('sortBy');
  return {
    page: Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1,
    limit: AUDIT_PAGE_SIZES.includes(rawLimit) ? rawLimit : DEFAULT_AUDIT_LIMIT,
    category: AUDIT_CATEGORIES.includes(category) ? category : '',
    action: (params.get('action') || '').trim(),
    actorId: OBJECT_ID.test(actorId) ? actorId : '',
    targetUserId: OBJECT_ID.test(targetUserId) ? targetUserId : '',
    sortBy: AUDIT_SORTS.includes(sortBy) ? sortBy : DEFAULT_AUDIT_SORT,
  };
}

/**
 * Next search string after applying `patch` to the query in `search`. Params this
 * view does not own are left alone; defaults are dropped so a bare URL is the default view.
 */
export function withAuditQuery(search, patch) {
  const resetPage = PAGE_RESET_KEYS.some((key) => key in patch) && !('page' in patch);
  const next = { ...auditQueryFromSearch(search), ...patch, ...(resetPage ? { page: 1 } : {}) };
  const params = new URLSearchParams(search);
  const put = (key, value, isDefault) => {
    if (isDefault) params.delete(key);
    else params.set(key, String(value));
  };
  put('category', next.category, !next.category);
  put('action', next.action, !next.action);
  put('actorId', next.actorId, !next.actorId);
  put('targetUserId', next.targetUserId, !next.targetUserId);
  put('sortBy', next.sortBy, !next.sortBy || next.sortBy === DEFAULT_AUDIT_SORT);
  put('page', next.page, !(next.page > 1));
  put('limit', next.limit, !next.limit || next.limit === DEFAULT_AUDIT_LIMIT);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Query params for GET /rbac/audit-log. Empty filters are left out rather than sent blank. */
export function auditListParams(query) {
  const params = { page: query.page, limit: query.limit, sortBy: query.sortBy };
  if (query.category) params.category = query.category;
  if (query.action) params.action = query.action;
  if (query.actorId) params.actorId = query.actorId;
  if (query.targetUserId) params.targetUserId = query.targetUserId;
  return params;
}

export function hasActiveAuditFilters(query) {
  return Boolean(query.category || query.action || query.actorId || query.targetUserId);
}
