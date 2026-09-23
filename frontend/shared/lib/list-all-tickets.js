import { listTickets } from '@/shared/api/tickets.js';

const ALL_PAGE_LIMIT = 100;
const ALL_PAGE_CAP = 10;

/**
 * Every ticket matching `params`, 100 at a time. Returns the first page's
 * response (totals included) with `results` replaced by the full list.
 * ponytail: capped at 1,000 tickets (`truncated`); a server-side group/count
 * endpoint is the upgrade if lists regularly outgrow that.
 */
export async function listAllTickets(params, { signal } = {}) {
  let first = null;
  const all = [];
  for (let page = 1; page <= ALL_PAGE_CAP; page += 1) {
    // Sequential on purpose: page N+1 needs page N's totalPages.
    const res = await listTickets({ ...params, page, limit: ALL_PAGE_LIMIT }, { signal });
    first ??= res;
    all.push(...res.results);
    if (page >= (res.totalPages || 1)) return { ...first, results: all, truncated: false };
  }
  return { ...first, results: all, truncated: true };
}
