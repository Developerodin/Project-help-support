import { describe, expect, it } from 'vitest';
import {
  buildTicketListQuery,
  clampTicketListPage,
  filtersFromSearch,
  hasFilterParams,
  limitFromSearch,
  pageFromSearch,
  resolveViewFilters,
  resolveViewProject,
  resolveViewSort,
  sortFromSearch,
  staleProjectFilters,
  TICKET_PAGE_SIZES,
  windowedPageNumbers,
  withFilterParams,
  withLimitParam,
  withPageParam,
  withProjectParam,
  withBoardMineParam,
  withSortParam,
} from './ticket-list-query.js';
import { DEFAULT_TICKET_PREFERENCES } from '@pms/shared';

describe('clampTicketListPage', () => {
  it('keeps page within total pages', () => {
    expect(clampTicketListPage(1, 3)).toBe(1);
    expect(clampTicketListPage(3, 3)).toBe(3);
    expect(clampTicketListPage(4, 3)).toBe(3);
  });

  it('normalizes invalid values', () => {
    expect(clampTicketListPage(0, 3)).toBe(1);
    expect(clampTicketListPage(-2, 3)).toBe(1);
    expect(clampTicketListPage(2, 0)).toBe(1);
    expect(clampTicketListPage(undefined, undefined)).toBe(1);
  });
});

describe('staleProjectFilters', () => {
  const owners = ['u1', 'u2'];

  it('returns null while the option set is still unresolved', () => {
    // The whole point: a load in flight must never clear a real filter.
    expect(staleProjectFilters({ assignedTo: 'u9' }, { ownerIds: null })).toBe(null);
    expect(staleProjectFilters({ assignedTo: 'u9' }, {})).toBe(null);
  });

  it('returns null when the owner is offered by the current project', () => {
    expect(staleProjectFilters({ assignedTo: 'u1' }, { ownerIds: owners })).toBe(null);
  });

  it('returns null when no owner filter is set', () => {
    expect(staleProjectFilters({ assignedTo: '' }, { ownerIds: owners })).toBe(null);
    expect(staleProjectFilters({}, { ownerIds: [] })).toBe(null);
  });

  it('clears an owner the resolved option set does not offer', () => {
    expect(staleProjectFilters({ assignedTo: 'u9' }, { ownerIds: owners }))
      .toEqual({ assignedTo: '' });
  });

  it('clears an owner when the project resolves with no members at all', () => {
    // Resolved-empty is a real answer, unlike null. All Projects lands here.
    expect(staleProjectFilters({ assignedTo: 'u9' }, { ownerIds: [] }))
      .toEqual({ assignedTo: '' });
  });
});

describe('pageFromSearch', () => {
  it('reads the page param', () => {
    expect(pageFromSearch('?page=4')).toBe(4);
    expect(pageFromSearch('?ticket=WEB-63&page=12')).toBe(12);
  });

  it('falls back to 1 for anything unusable', () => {
    expect(pageFromSearch('')).toBe(1);
    expect(pageFromSearch('?page=0')).toBe(1);
    expect(pageFromSearch('?page=-3')).toBe(1);
    expect(pageFromSearch('?page=abc')).toBe(1);
    expect(pageFromSearch('?page=2.7')).toBe(2);
  });
});

describe('limitFromSearch', () => {
  it('accepts an offered page size', () => {
    expect(limitFromSearch('?limit=50', 25)).toBe(50);
    expect(limitFromSearch('?limit=100', 25)).toBe(100);
  });

  it('falls back for a size that is not offered', () => {
    // The API caps at 100; anything else is a hand-edited URL, not a view.
    expect(limitFromSearch('?limit=7', 25)).toBe(25);
    expect(limitFromSearch('?limit=500', 25)).toBe(25);
    expect(limitFromSearch('', 25)).toBe(25);
    expect(limitFromSearch('?limit=abc', 50)).toBe(50);
  });

  it('falls back to the first offered size when the fallback is junk', () => {
    expect(limitFromSearch('', undefined)).toBe(TICKET_PAGE_SIZES[0]);
  });
});

describe('withPageParam', () => {
  it('writes the page and preserves everything else', () => {
    expect(withPageParam('?ticket=WEB-63', 3)).toBe('?ticket=WEB-63&page=3');
  });

  it('omits page=1 so the default view has a clean URL', () => {
    expect(withPageParam('?page=4', 1)).toBe('');
    expect(withPageParam('?ticket=WEB-63&page=4', 1)).toBe('?ticket=WEB-63');
  });

  it('replaces an existing page rather than appending one', () => {
    expect(withPageParam('?page=4', 9)).toBe('?page=9');
  });
});

describe('withLimitParam', () => {
  it('writes a non-default page size', () => {
    expect(withLimitParam('?page=2', 50)).toBe('?page=2&limit=50');
  });

  it('omits the default limit', () => {
    expect(withLimitParam('?limit=50', DEFAULT_TICKET_PREFERENCES.limit)).toBe('');
  });
});

describe('withSortParam', () => {
  it('writes a non-default sort', () => {
    expect(withSortParam('', { column: 'title', direction: 'asc' })).toBe('?sortBy=title%3Aasc');
  });

  it('omits the default sort', () => {
    expect(withSortParam('?sortBy=title%3Aasc', DEFAULT_TICKET_PREFERENCES.sort)).toBe('');
  });
});

describe('sortFromSearch', () => {
  it('reads sortBy from the URL', () => {
    expect(sortFromSearch('?sortBy=title%3Aasc', DEFAULT_TICKET_PREFERENCES.sort))
      .toEqual({ column: 'title', direction: 'asc' });
  });

  it('falls back when sortBy is missing or invalid', () => {
    expect(sortFromSearch('', { column: 'status', direction: 'desc' }))
      .toEqual({ column: 'status', direction: 'desc' });
    expect(sortFromSearch('?sortBy=nope', DEFAULT_TICKET_PREFERENCES.sort))
      .toEqual(DEFAULT_TICKET_PREFERENCES.sort);
  });
});

describe('resolveViewSort', () => {
  it('lets the URL win when sortBy is present', () => {
    expect(resolveViewSort('?sortBy=status%3Aasc', { sort: { column: 'ticketId', direction: 'desc' } }))
      .toEqual({ column: 'status', direction: 'asc' });
  });

  it('falls back to saved preferences when the URL is silent', () => {
    expect(resolveViewSort('?page=2', { sort: { column: 'owner', direction: 'asc' } }))
      .toEqual({ column: 'owner', direction: 'asc' });
  });
});

describe('windowedPageNumbers', () => {
  it('returns a compact range with ellipsis markers', () => {
    expect(windowedPageNumbers(5, 10)).toEqual([1, '…', 3, 4, 5, 6, 7, '…', 10]);
  });

  it('returns a single page for short lists', () => {
    expect(windowedPageNumbers(1, 1)).toEqual([1]);
  });
});

describe('withProjectParam', () => {
  it('writes a project id and omits all-projects', () => {
    expect(withProjectParam('?page=2', 'proj-1')).toBe('?page=2&project=proj-1');
    expect(withProjectParam('?project=old', null)).toBe('');
  });
});

describe('withBoardMineParam', () => {
  it('writes mine=1 only when board scope is mine', () => {
    expect(withBoardMineParam('', true)).toBe('?mine=1');
    expect(withBoardMineParam('?mine=1', false)).toBe('');
  });
});

describe('resolveViewProject', () => {
  it('lets the URL win when project is present', () => {
    expect(resolveViewProject('?project=url-proj', 'ctx-proj')).toBe('url-proj');
  });

  it('falls back to the active project when the URL is silent', () => {
    expect(resolveViewProject('?page=2', 'ctx-proj')).toBe('ctx-proj');
  });
});

describe('buildTicketListQuery', () => {
  const prefs = { filters: { q: 'admin' }, sort: { column: 'ticketId', direction: 'desc' } };

  it('sends the live search term by default', () => {
    expect(buildTicketListQuery({ preferences: prefs }).q).toBe('admin');
  });

  it('lets the caller substitute a debounced search term', () => {
    // Typing must not reach the API on every keystroke.
    expect(buildTicketListQuery({ preferences: prefs, qOverride: 'adm' }).q).toBe('adm');
    expect(buildTicketListQuery({ preferences: prefs, qOverride: '' }).q).toBe(undefined);
  });
});

describe('hasFilterParams', () => {
  it('detects any filter key, and ignores the ones that are not filters', () => {
    expect(hasFilterParams('?status=review')).toBe(true);
    expect(hasFilterParams('?category=Bug')).toBe(true);
    expect(hasFilterParams('?severity=Critical')).toBe(true);
    expect(hasFilterParams('?blocked=1')).toBe(true);
    expect(hasFilterParams('')).toBe(false);
    expect(hasFilterParams('?page=3&limit=50&ticket=WEB-63')).toBe(false);
  });
});

describe('filtersFromSearch', () => {
  it('reads named filters and defaults the rest', () => {
    expect(filtersFromSearch('?status=review&blocked=1')).toEqual({
      q: '', status: 'review', priority: '', category: '', severity: '',
      scope: 'all', assignedTo: '',
      blocked: true, overdue: false, reopened: false, newReply: false,
    });
  });

  it('reads category and severity filters', () => {
    expect(filtersFromSearch('?category=Bug&severity=Critical')).toEqual({
      q: '', status: '', priority: '', category: 'Bug', severity: 'Critical',
      scope: 'all', assignedTo: '',
      blocked: false, overdue: false, reopened: false, newReply: false,
    });
  });

  it('treats a flag as on only for 1', () => {
    expect(filtersFromSearch('?blocked=false').blocked).toBe(false);
    expect(filtersFromSearch('?blocked=0').blocked).toBe(false);
    expect(filtersFromSearch('?blocked=1').blocked).toBe(true);
  });
});

describe('withFilterParams', () => {
  it('writes only the filters that are actually on', () => {
    expect(withFilterParams('', { status: 'review', overdue: true }))
      .toBe('?status=review&overdue=1');
  });

  it('omits defaults so a plain view has a plain URL', () => {
    expect(withFilterParams('', { scope: 'all', q: '', blocked: false })).toBe('');
  });

  it('leaves ticket, page and limit alone', () => {
    expect(withFilterParams('?ticket=WEB-63&page=3&limit=50', { status: 'review' }))
      .toBe('?ticket=WEB-63&page=3&limit=50&status=review');
  });

  it('drops a filter that is switched back off', () => {
    expect(withFilterParams('?status=review&blocked=1', { status: '', blocked: false }))
      .toBe('');
  });
});

describe('resolveViewFilters', () => {
  const saved = { filters: { status: 'blocked', priority: 'Urgent' } };

  it('falls back to saved preferences when the URL names no filter', () => {
    const resolved = resolveViewFilters('?page=2', saved);
    expect(resolved.status).toBe('blocked');
    expect(resolved.priority).toBe('Urgent');
  });

  it('lets the URL win for every filter once it names any', () => {
    // A shared link must show its recipient what its sender saw, so a saved
    // priority must not leak into someone else's view.
    const resolved = resolveViewFilters('?status=review', saved);
    expect(resolved.status).toBe('review');
    expect(resolved.priority).toBe('');
  });
});
