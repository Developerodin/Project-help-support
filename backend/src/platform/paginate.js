const MAX_LIMIT = 100;
// Sorting by a secret is an oracle: page order leaks its value. Never honoured,
// allowlist or not. A leading `$` is not a field and would make Mongo throw.
const NEVER_SORTABLE = /password|token|secret|^\$/i;

/**
 * "field:asc,other:desc" -> Mongo sort object. Fields outside `sortable` (when
 * given) are dropped; nothing left falls back to createdAt desc. `_id` is always
 * the last key so equal values page deterministically instead of overlapping.
 */
export function parseSortBy(sortBy, sortable = null) {
  const sort = {};
  for (const part of String(sortBy || '').split(',')) {
    const [rawField, direction] = part.split(':');
    const field = rawField?.trim();
    if (!field || NEVER_SORTABLE.test(field)) continue;
    if (sortable && field !== '_id' && !sortable.includes(field)) continue;
    sort[field] = direction?.trim() === 'desc' ? -1 : 1;
  }
  if (Object.keys(sort).length === 0) sort.createdAt = -1;
  if (!('_id' in sort)) sort._id = Object.values(sort).at(-1);
  return sort;
}

/**
 * ponytail: a plain function, not a schema plugin. Three surfaces paginate in
 * this product; a plugin would be ceremony. Promote it if that changes.
 *
 * sortBy format: "field:asc,other:desc". Unparseable entries are ignored rather
 * than throwing, because sort order arrives from a query string. Pass
 * `sortable` (field names) whenever sortBy comes from a client.
 */
export async function paginate(model, filter = {}, options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(options.limit) || 20));

  const sort = parseSortBy(options.sortBy, options.sortable);

  let query = model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit);
  if (options.select) query = query.select(options.select);
  for (const p of options.populate || []) query = query.populate(p);

  const [results, totalResults] = await Promise.all([
    query.exec(),
    model.countDocuments(filter).exec(),
  ]);

  return {
    results,
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit),
    totalResults,
    resultsTruncated: totalResults > page * limit || (page === 1 && totalResults > results.length),
  };
}
