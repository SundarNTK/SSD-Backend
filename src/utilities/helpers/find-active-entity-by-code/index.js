const Entity = require("../../../models/entities");

function findActiveEntityByCode(code) {
  return Entity.findOne(Entity.notDeletedFilter({ code: String(code).trim().toUpperCase() }));
}

module.exports = findActiveEntityByCode;
