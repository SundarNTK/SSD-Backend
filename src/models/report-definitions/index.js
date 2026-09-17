const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * A saved custom report — a name, which report source it reads from, which
 * fields to show (in order), the filter conditions, optional grouping/
 * aggregation, and multi-level sort. This is the whole "build once, run
 * forever" point of the Report Builder (see common/reports/
 * report-sources.js): without this, every "just the fields I need" report
 * would have to be rebuilt from scratch on every visit instead of picked
 * from a saved list.
 *
 * Deliberately holds no cached RESULTS — only the report's shape. Running
 * it always re-executes the aggregation live (see common/reports/
 * report-runner.js), so a saved report never shows stale data.
 */
const conditionSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    operator: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    valueTo: { type: mongoose.Schema.Types.Mixed, default: null },
    logic: { type: String, enum: ["AND", "OR"], default: "AND" },
  },
  { _id: false }
);

const aggregationSchema = new mongoose.Schema(
  {
    field: { type: String, default: null },
    fn: { type: String, enum: ["sum", "count", "avg", "min", "max"], required: true },
  },
  { _id: false }
);

const groupingSchema = new mongoose.Schema(
  {
    groupBy: { type: String, required: true },
    aggregations: { type: [aggregationSchema], required: true, validate: { validator: (v) => v.length > 0, message: "At least one aggregation is required." } },
  },
  { _id: false }
);

const sortItemSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    dir: { type: String, enum: ["asc", "desc"], default: "desc" },
  },
  { _id: false }
);

const reportDefinitionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  sourceKey: { type: String, required: true, trim: true },
  // Ordered — this is the column order the report renders in, not just a set.
  fields: { type: [String], default: [] },
  conditions: { type: [conditionSchema], default: [] },
  grouping: { type: groupingSchema, default: null },
  sort: { type: [sortItemSchema], default: [] },
});

reportDefinitionSchema.plugin(auditablePlugin);

// Unique per-owner, not global — two admins may both reasonably want a
// report named "Weekly Payments" without colliding.
reportDefinitionSchema.index(
  { createdBy: 1, name: 1 },
  activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } })
);
reportDefinitionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("ReportDefinition", reportDefinitionSchema);
