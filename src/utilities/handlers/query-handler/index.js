/**
 * Builds the paginated list-query shape every "list" endpoint in this
 * service was hand-rolling identically (common/factories/crud-controller.js
 * and controllers/users/index.js's `list`, in particular) — page/
 * pageSize clamping, the soft-delete filter, an optional `status` filter,
 * and an optional case-insensitive `$or` search across a set of fields.
 *
 * Callers with extra filter fields of their own (e.g. `userType`, `role` on
 * the User list) add them to `filter` after calling this — this only owns
 * the part that's genuinely identical across every module.
 */
function queryHandler(req, { notDeletedFilter, searchFields = [] } = {}) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
  const filter = notDeletedFilter ? notDeletedFilter() : {};

  // "" shows up when a frontend "All statuses" filter is wired to send the
  // param unconditionally rather than omitting it — Number("") is 0, which
  // would silently filter down to Inactive-only, so treat it as absent.
  if (req.query.status !== undefined && req.query.status !== "") {
    filter.status = Number(req.query.status);
  }

  if (req.query.search && searchFields.length > 0) {
    const regex = new RegExp(req.query.search.trim(), "i");
    filter.$or = searchFields.map((field) => ({ [field]: regex }));
  }

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    filter,
    sort: { createdAt: -1 },
  };
}

module.exports = queryHandler;
