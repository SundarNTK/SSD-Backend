const Entity = require("../../../models/entities");

function findActiveEntityById(id) {
  return Entity.findOne(Entity.notDeletedFilter({ _id: id }));
}

module.exports = findActiveEntityById;
