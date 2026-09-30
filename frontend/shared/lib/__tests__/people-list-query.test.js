import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PEOPLE_LIMIT,
  parsePeopleListParams,
} from '../people-list-query.js';

describe('parsePeopleListParams', () => {
  it('returns defaults for an empty query', () => {
    expect(parsePeopleListParams('')).toEqual({
      page: 1,
      limit: DEFAULT_PEOPLE_LIMIT,
      urlSearch: '',
      role: '',
      status: '',
    });
  });

  it('reads page, limit, search, role, and status', () => {
    expect(parsePeopleListParams('?page=2&limit=50&search=ada&role=developer&status=active')).toEqual({
      page: 2,
      limit: 50,
      urlSearch: 'ada',
      role: 'developer',
      status: 'active',
    });
  });

  it('accepts q as an alias for search', () => {
    expect(parsePeopleListParams('?q=bob')).toEqual({
      page: 1,
      limit: DEFAULT_PEOPLE_LIMIT,
      urlSearch: 'bob',
      role: '',
      status: '',
    });
  });

  it('ignores invalid limit, role, and status', () => {
    expect(parsePeopleListParams('?limit=999&role=not-a-role&status=unknown')).toEqual({
      page: 1,
      limit: DEFAULT_PEOPLE_LIMIT,
      urlSearch: '',
      role: '',
      status: '',
    });
  });
});
