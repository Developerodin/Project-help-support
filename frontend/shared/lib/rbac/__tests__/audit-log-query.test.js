import { describe, expect, it } from 'vitest';
import {
  CLEARED_AUDIT_FILTERS,
  DEFAULT_AUDIT_QUERY,
  auditListParams,
  auditQueryFromSearch,
  withAuditQuery,
} from '@/shared/lib/rbac/audit-log-query.js';

const ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

describe('auditQueryFromSearch', () => {
  it('returns defaults for an empty search', () => {
    expect(auditQueryFromSearch('')).toEqual(DEFAULT_AUDIT_QUERY);
  });

  it('reads every param the view owns', () => {
    expect(auditQueryFromSearch(
      `?category=security&action=login&ticketId=web-12&actorId=${ID}&targetUserId=${ID}&sortBy=createdAt:asc&page=4&limit=100`,
    )).toEqual({
      page: 4,
      limit: 100,
      category: 'security',
      action: 'login',
      ticketId: 'WEB-12',
      actorId: ID,
      targetUserId: ID,
      sortBy: 'createdAt:asc',
    });
  });

  it('accepts the ticket category', () => {
    expect(auditQueryFromSearch('?category=ticket&action=WEB-12')).toMatchObject({
      category: 'ticket', action: 'WEB-12',
    });
  });

  it('falls back to defaults for values outside the allowed sets', () => {
    expect(auditQueryFromSearch('?category=x&limit=30&page=0&sortBy=action:asc&targetUserId=abc'))
      .toEqual(DEFAULT_AUDIT_QUERY);
  });
});

describe('withAuditQuery', () => {
  it('resets the page when a filter, sort or page size changes', () => {
    expect(withAuditQuery('?page=3', { category: 'policy' })).toBe('?category=policy');
    expect(withAuditQuery('?page=3', { sortBy: 'createdAt:asc' })).toBe('?sortBy=createdAt%3Aasc');
    expect(withAuditQuery('?page=3', { limit: 20 })).toBe('?limit=20');
    expect(withAuditQuery('?page=3', { ticketId: 'WEB-12' })).toBe('?ticketId=WEB-12');
  });

  it('keeps filters when only the page changes', () => {
    expect(withAuditQuery('?category=access&action=grant', { page: 2 }))
      .toBe('?category=access&action=grant&page=2');
  });

  it('drops defaults and leaves params it does not own alone', () => {
    expect(withAuditQuery('?notif=n1&category=access&page=2', CLEARED_AUDIT_FILTERS)).toBe('?notif=n1');
    expect(withAuditQuery('?limit=50&sortBy=createdAt:desc', { page: 1 })).toBe('');
  });
});

describe('auditListParams', () => {
  it('sends page, limit and sort, and only the filters that are set', () => {
    expect(auditListParams({ ...DEFAULT_AUDIT_QUERY, category: 'whatsapp', page: 2 }))
      .toEqual({ page: 2, limit: 50, sortBy: 'createdAt:desc', category: 'whatsapp' });
    expect(auditListParams({ ...DEFAULT_AUDIT_QUERY, action: 'ticket.created', ticketId: 'WEB-12' }))
      .toEqual({
        page: 1, limit: 50, sortBy: 'createdAt:desc', action: 'ticket.created', ticketId: 'WEB-12',
      });
  });
});
