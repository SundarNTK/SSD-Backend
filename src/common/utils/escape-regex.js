/**
 * Every list/search endpoint builds a case-insensitive RegExp straight from
 * `req.query.search` (see common/factories/crud-controller.js and
 * utilities/handlers/query-handler). Without this, an authenticated user —
 * any authenticated user, including a low-privilege one — could submit a
 * pathological pattern (e.g. "(a+)+$") as the search term and hang the
 * single-threaded Node event loop for every other request in flight
 * (a classic ReDoS). Escaping the regex metacharacters first means the
 * search term is only ever matched literally, never compiled as a pattern.
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = escapeRegex;
