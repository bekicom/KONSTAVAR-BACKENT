/**
 * Pagination + sorting helper. Standardises every list endpoint:
 *   ?page=1&limit=50&sort=createdAt:-1&sort=_id:-1
 * or, for backwards-compat with existing Flutter calls:
 *   ?limit=50
 *
 * Caller passes a base Mongoose Query (or builds one from a filter). We
 * return `{ items, total, page, limit, pages, hasMore }`.
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const parsePositiveInt = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};

const parsePagination = (query) => {
  const limit = Math.min(
    MAX_LIMIT,
    parsePositiveInt(query.limit, DEFAULT_LIMIT),
  );
  let page = parsePositiveInt(query.page, DEFAULT_PAGE);
  let skip = parsePositiveInt(query.skip, null);
  if (skip === null) {
    skip = (page - 1) * limit;
  } else {
    page = Math.floor(skip / limit) + 1;
  }
  return { page, limit, skip };
};

const parseSort = (rawSort, defaultSort = { createdAt: -1, _id: -1 }) => {
  if (!rawSort) return defaultSort;
  const tokens = Array.isArray(rawSort) ? rawSort : String(rawSort).split(",");
  const sort = {};
  for (const token of tokens) {
    const [field, dirRaw] = String(token || "").split(":");
    if (!field) continue;
    const dir = String(dirRaw || "").toLowerCase();
    sort[field.trim()] = dir === "-1" || dir === "desc" ? -1 : 1;
  }
  // Always include _id as final tiebreaker for stable pagination.
  if (!("_id" in sort)) sort._id = -1;
  return sort;
};

/**
 * Run a paginated query against a Mongoose model.
 *
 * @param {object} options
 * @param {import('mongoose').Model} options.Model - The Mongoose model
 * @param {object} options.filter - The find filter
 * @param {object} options.queryParams - req.query
 * @param {object} [options.defaultSort] - default sort spec
 * @param {(query: import('mongoose').Query) => import('mongoose').Query} [options.populate] - optional populate hook
 * @param {(query: import('mongoose').Query) => import('mongoose').Query} [options.project] - optional .select() hook
 * @returns {Promise<{items: any[], total: number, page: number, limit: number, pages: number, hasMore: boolean}>}
 */
const paginateQuery = async ({
  Model,
  filter = {},
  queryParams = {},
  defaultSort,
  populate,
  project,
}) => {
  const { page, limit, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams.sort, defaultSort);

  let q = Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (typeof project === "function") q = project(q);
  if (typeof populate === "function") q = populate(q);

  const [items, total] = await Promise.all([
    q.exec(),
    Model.countDocuments(filter),
  ]);

  const pages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    items,
    total,
    page,
    limit,
    pages,
    // `skip` bilan chaqirilganda `page < pages` noto'g'ri bo'lishi mumkin,
    // shuning uchun haqiqiy o'qilgan yozuvlar soniga qarab hisoblaymiz.
    hasMore: skip + items.length < total,
  };
};

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
  parseSort,
  paginateQuery,
};
