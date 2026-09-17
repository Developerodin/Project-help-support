import { listTeams } from '@/shared/api/teams.js';

const PAGE_SIZE = 100;

/**
 * Load every team page the caller can see (active by default).
 * Stops when all `totalResults` are fetched or a page returns empty.
 */
export async function fetchAllTeams(params = {}) {
  const base = { limit: PAGE_SIZE, ...params };
  let page = 1;
  const all = [];
  let totalResults = Infinity;

  while (all.length < totalResults) {
    const res = await listTeams({ ...base, page });
    const batch = res.results || [];
    all.push(...batch);
    totalResults = res.totalResults ?? all.length;
    if (!batch.length || page >= (res.totalPages || 1)) break;
    page += 1;
  }

  return {
    results: all,
    totalResults: totalResults === Infinity ? all.length : totalResults,
    resultsTruncated: all.length < totalResults,
  };
}
