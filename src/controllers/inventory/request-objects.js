const Joi = require("joi");

const objectId = Joi.string().hex().length(24);

const createAdjustmentSchema = Joi.object({
  refType: Joi.string().valid("Item", "Service").required(),
  refId: objectId.required(),
  inventoryType: Joi.string().valid("Stock In", "Stock Out").required(),
  quantity: Joi.number().integer().min(1).required(),
  remarks: Joi.string().allow("").default(""),
});

module.exports = { createAdjustmentSchema };
