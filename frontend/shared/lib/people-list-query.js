import { PEOPLE_ASSIGNABLE_ROLES, ROLE_IDS } from '@pms/shared';

export const PEOPLE_PAGE_SIZES = Object.freeze([25, 50, 100]);
export const DEFAULT_PEOPLE_LIMIT = PEOPLE_PAGE_SIZES[0];
export const PEOPLE_FILTER_STATUSES = Object.freeze(['invited', 'active', 'inactive', 'deleted']);

const PEOPLE_FILTER_ROLES = Object.freeze([...PEOPLE_ASSIGNABLE_ROLES, ROLE_IDS.SUPER_ADMIN]);

/**
 * Parse People list URL query (page, limit, search/q, role, status).
 */
export function parsePeopleListParams(searchString) {
  const params = new URLSearchParams(searchString);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const limit = PEOPLE_PAGE_SIZES.includes(Number(params.get('limit')))
    ? Number(params.get('limit'))
    : DEFAULT_PEOPLE_LIMIT;
  const urlSearch = params.get('search') || params.get('q') || '';
  const role = PEOPLE_FILTER_ROLES.includes(params.get('role')) ? params.get('role') : '';
  const status = PEOPLE_FILTER_STATUSES.includes(params.get('status')) ? params.get('status') : '';
  return { page, limit, urlSearch, role, status };
}
