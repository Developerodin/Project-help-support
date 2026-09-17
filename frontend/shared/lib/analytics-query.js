import { TICKET_PROJECT_PARAM } from './ticket-list-query.js';

export const ANALYTICS_TREND_GROUP_PARAM = 'trendGroupBy';
export const ANALYTICS_DELIVERY_GROUP_PARAM = 'deliveryGroupBy';
export const ANALYTICS_WINDOW_PARAM = 'windowDays';
export const ANALYTICS_DIMENSION_PARAM = 'dimension';

const DEFAULTS = Object.freeze({
  trendGroupBy: 'day',
  deliveryGroupBy: 'day',
  windowDays: 30,
  dimension: 'severity',
});

const DIMENSION_LIST_PARAMS = Object.freeze({
  severity: 'severity',
  module: 'module',
  category: 'category',
  environment: 'environment',
  label: 'label',
  priority: 'priority',
});

/** Drill row keys that cannot map to a list filter. */
const NON_LINKABLE_KEYS = new Set(['Unassigned', 'No Team', 'No Label', 'Unspecified']);

export function analyticsViewFromSearch(search) {
  const params = new URLSearchParams(search);
  const trendGroupBy = params.get(ANALYTICS_TREND_GROUP_PARAM) === 'week' ? 'week' : DEFAULTS.trendGroupBy;
  const deliveryGroupBy = params.get(ANALYTICS_DELIVERY_GROUP_PARAM) === 'week' ? 'week' : DEFAULTS.deliveryGroupBy;
  const windowRaw = Number.parseInt(params.get(ANALYTICS_WINDOW_PARAM), 10);
  const windowDays = Number.isFinite(windowRaw) ? Math.max(7, Math.min(90, windowRaw)) : DEFAULTS.windowDays;
  const dimension = params.get(ANALYTICS_DIMENSION_PARAM) || DEFAULTS.dimension;
  const project = params.get(TICKET_PROJECT_PARAM) || null;

  return {
    trendGroupBy,
    deliveryGroupBy,
    windowDays,
    dimension,
    project,
  };
}

export function withAnalyticsViewParams(search, patch = {}) {
  const current = analyticsViewFromSearch(search);
  const next = { ...current, ...patch };
  const params = new URLSearchParams(search);

  if (next.trendGroupBy !== DEFAULTS.trendGroupBy) params.set(ANALYTICS_TREND_GROUP_PARAM, next.trendGroupBy);
  else params.delete(ANALYTICS_TREND_GROUP_PARAM);

  if (next.deliveryGroupBy !== DEFAULTS.deliveryGroupBy) {
    params.set(ANALYTICS_DELIVERY_GROUP_PARAM, next.deliveryGroupBy);
  } else params.delete(ANALYTICS_DELIVERY_GROUP_PARAM);

  if (next.windowDays !== DEFAULTS.windowDays) params.set(ANALYTICS_WINDOW_PARAM, String(next.windowDays));
  else params.delete(ANALYTICS_WINDOW_PARAM);

  if (next.dimension !== DEFAULTS.dimension) params.set(ANALYTICS_DIMENSION_PARAM, next.dimension);
  else params.delete(ANALYTICS_DIMENSION_PARAM);

  if (next.project) params.set(TICKET_PROJECT_PARAM, next.project);
  else params.delete(TICKET_PROJECT_PARAM);

  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/**
 * Build /tickets drill-down href for analytics breakdown rows and stage bars.
 */
export function analyticsDrillListHref({ projectId, status, dimension, rowKey } = {}) {
  const search = new URLSearchParams();
  if (projectId) search.set(TICKET_PROJECT_PARAM, projectId);
  if (status) search.set('status', status);

  if (dimension && rowKey && !NON_LINKABLE_KEYS.has(rowKey)) {
    const param = DIMENSION_LIST_PARAMS[dimension];
    if (param) search.set(param, rowKey);
  }

  const qs = search.toString();
  return qs ? `/tickets?${qs}` : '/tickets';
}

export { DEFAULTS as ANALYTICS_VIEW_DEFAULTS };
