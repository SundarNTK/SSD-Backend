/**
 * uuid@14 ships ESM-only for its Node entry point, which real Node resolves
 * fine (newer Node versions support require(esm) transparently) but Jest's
 * CJS-only transform pipeline can't parse. Only `v4()` is used anywhere in
 * this codebase (src/models/entities), so the mock only needs to cover that.
 */
const crypto = require("crypto");

module.exports = { v4: () => crypto.randomUUID() };
