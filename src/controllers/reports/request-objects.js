const Joi = require("joi");

const conditionSchema = Joi.object({
  field: Joi.string().required(),
  operator: Joi.string().required(),
  value: Joi.any(),
  valueTo: Joi.any(),
  // The connector from THIS condition to the next one in the list — see
  // common/reports/report-filters.js's foldConditions for exactly how a
  // mixed AND/OR chain is folded. Unused on the last condition.
  logic: Joi.string().valid("AND", "OR").default("AND"),
});

const aggregationSchema = Joi.object({
  field: Joi.string().when("fn", { is: "count", then: Joi.optional(), otherwise: Joi.required() }),
  fn: Joi.string().valid("sum", "count", "avg", "min", "max").required(),
});

const groupingSchema = Joi.object({
  groupBy: Joi.string().required(),
  aggregations: Joi.array().items(aggregationSchema).min(1).required(),
}).allow(null);

const sortItemSchema = Joi.object({
  field: Joi.string().required(),
  dir: Joi.string().valid("asc", "desc").default("desc"),
});

const runSchema = Joi.object({
  sourceKey: Joi.string().required(),
  fields: Joi.array().items(Joi.string()).default([]),
  conditions: Joi.array().items(conditionSchema).default([]),
  grouping: groupingSchema.default(null),
  sort: Joi.array().items(sortItemSchema).default([]),
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(200).default(25),
});

const saveDefinitionSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).required(),
  sourceKey: Joi.string().required(),
  fields: Joi.array().items(Joi.string()).default([]),
  conditions: Joi.array().items(conditionSchema).default([]),
  grouping: groupingSchema.default(null),
  sort: Joi.array().items(sortItemSchema).default([]),
});

const updateDefinitionSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150),
  sourceKey: Joi.string(),
  fields: Joi.array().items(Joi.string()),
  conditions: Joi.array().items(conditionSchema),
  grouping: groupingSchema,
  sort: Joi.array().items(sortItemSchema),
});

module.exports = { runSchema, saveDefinitionSchema, updateDefinitionSchema };
