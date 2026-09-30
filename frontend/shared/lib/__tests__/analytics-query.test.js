import { describe, it, expect } from 'vitest';
import {
  analyticsDrillListHref,
  analyticsViewFromSearch,
  withAnalyticsViewParams,
} from '../analytics-query.js';
import { filtersFromSearch } from '../ticket-list-query.js';

describe('analyticsDrillListHref', () => {
  it('maps stage status and severity dimension to ticket list query', () => {
    expect(analyticsDrillListHref({
      projectId: '507f1f77bcf86cd799439011',
      status: 'in_progress',
    })).toBe('/tickets?project=507f1f77bcf86cd799439011&status=in_progress');

    expect(analyticsDrillListHref({
      projectId: '507f1f77bcf86cd799439011',
      dimension: 'severity',
      rowKey: 'Critical',
    })).toBe('/tickets?project=507f1f77bcf86cd799439011&severity=Critical');
  });

  it('skips non-linkable drill keys', () => {
    expect(analyticsDrillListHref({
      dimension: 'assignee',
      rowKey: 'Unassigned',
    })).toBe('/tickets');
  });
});

describe('analytics URL view params', () => {
  it('round-trips trend and delivery group by separately', () => {
    const href = withAnalyticsViewParams('', {
      trendGroupBy: 'week',
      deliveryGroupBy: 'day',
      windowDays: 60,
      dimension: 'module',
    });
    const view = analyticsViewFromSearch(href);
    expect(view.trendGroupBy).toBe('week');
    expect(view.deliveryGroupBy).toBe('day');
    expect(view.windowDays).toBe(60);
    expect(view.dimension).toBe('module');
  });
});

describe('ticket list URL filters for drill-down', () => {
  it('reads module environment and label from search', () => {
    const filters = filtersFromSearch('?module=Checkout&environment=Staging&label=regression');
    expect(filters.module).toBe('Checkout');
    expect(filters.environment).toBe('Staging');
    expect(filters.label).toBe('regression');
  });
});
