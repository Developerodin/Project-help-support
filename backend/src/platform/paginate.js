const MAX_LIMIT = 100;

/**
 * ponytail: a plain function, not a schema plugin. Three surfaces paginate in
 * this product; a plugin would be ceremony. Promote it if that changes.
 *
 * sortBy format: "field:asc,other:desc". Unparseable entries are ignored rather
 * than throwing, because sort order arrives from a query string.
 */
export async function paginate(model, filter = {}, options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(options.limit) || 20));

  const sort = {};
  if (options.sortBy) {
    for (const part of String(options.sortBy).split(',')) {
      const [field, direction] = part.split(':');
      if (field) sort[field.trim()] = direction?.trim() === 'desc' ? -1 : 1;
    }
  }
  if (Object.keys(sort).length === 0) sort.createdAt = -1;

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
  };
}
