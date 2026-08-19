const Entity = require("../../../models/entities");
const findActiveEntityByCode = require("../find-active-entity-by-code");

/**
 * Used by the seed script — SST needs to exist before the first user can be
 * assigned to it. Idempotent, so re-running the seed script never creates
 * a duplicate.
 */
async function ensureDefaultEntity({ code, name, templeName, templeTamilName }) {
  const existing = await findActiveEntityByCode(code);
  if (existing) return existing;

  return Entity.create({ code, name, templeName, templeTamilName });
}

module.exports = ensureDefaultEntity;
