const { getReportSource } = require("./report-sources");
const { buildFilterStages } = require("./report-filters");

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 25;
const AGGREGATION_FUNCTIONS = { sum: "$sum", avg: "$avg", min: "$min", max: "$max" };
const AGGREGATION_LABELS = { sum: "Sum of", avg: "Average of", min: "Min of", max: "Max of", count: "Count of" };

function fieldOrThrow(source, key) {
  const field = source.fields.find((f) => f.key === key);
  if (!field) throw `"${source.label}" has no field "${key}".`;
  return field;
}

function collectExtraStages(fields, pipeline) {
  const included = new Set();
  fields.forEach((f) => {
    if (typeof f.extraStages !== "function") return;
    const stageKey = f.stageKey || f.key;
    if (included.has(stageKey)) return;
    included.add(stageKey);
    pipeline.push(...f.extraStages());
  });
}

/**
 * Turns a chosen report source + selected field keys + filter conditions +
 * grouping + multi-level sort into one MongoDB aggregation pipeline and
 * runs it — the engine behind both the ad-hoc "Run Report" button and
 * re-running a saved report definition.
 *
 * Performance shape (see report-sources.js's own comment for the
 * denormalization side of this):
 *   1. Filter conditions run as a `$match` FIRST whenever every condition
 *      is on a "simple" (non-joined) field — using each model's existing
 *      indexes. The moment ANY condition touches a field that needs its
 *      own join/computation, the whole filter (not just that one
 *      condition) moves after the joins instead — see report-filters.js's
 *      buildFilterStages for why partial decomposition isn't attempted.
 *   2. A field's join/computation stages are appended ONLY when that
 *      field is actually selected, filtered on, sorted by, grouped by, or
 *      aggregated — deduplicated by `stageKey`. Deselect Category from an
 *      Item Sales report (and don't filter/sort/group by it either) and
 *      its three $lookup stages never run at all.
 *   3. Every join used is an indexed equality lookup — by `_id` or by
 *      `customer`, never a full collection scan.
 *   4. `$sort` runs BEFORE the projection/joins whenever every sort field
 *      is "simple" — keeps it a candidate for an index. Grouped reports
 *      always sort after `$group`, because the aggregated value doesn't
 *      exist any earlier.
 *   5. Paging and the total count come from ONE `$facet` — a single round
 *      trip, both branches reading the exact same filtered/joined stream.
 */
async function runReport({ sourceKey, fieldKeys, conditions = [], grouping = null, sort = [], page = 1, pageSize = DEFAULT_PAGE_SIZE }) {
  const source = getReportSource(sourceKey);

  const chosenFields = (Array.isArray(fieldKeys) ? fieldKeys : [])
    .map((k) => source.fields.find((f) => f.key === k))
    .filter(Boolean);
  if (!grouping && chosenFields.length === 0) throw "Select at least one field to run this report.";

  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));

  const pipeline = [...source.basePipeline];

  const { earlyMatch, lateMatch } = buildFilterStages(source, conditions);
  if (earlyMatch) pipeline.push({ $match: earlyMatch });

  if (grouping) {
    return runGroupedReport({ source, pipeline, lateMatch, grouping, sort, page: safePage, pageSize: safePageSize });
  }

  const sortDefs = (sort.length ? sort : [{ field: source.defaultSort.field, dir: source.defaultSort.dir }])
    .map((s) => ({ field: fieldOrThrow(source, s.field), dir: s.dir === "asc" ? 1 : -1 }));
  const sortIsComputed = sortDefs.some((s) => typeof s.field.extraStages === "function");

  // Sorting before a LATER $match doesn't change the final order among
  // survivors (filtering never reorders), so an uncomputed sort field can
  // still run early — and stay index-eligible — even when a separate
  // filter condition on some OTHER, computed field forces that filter
  // itself to run late. Only a sort field that's itself computed has to
  // wait until after its own join produces a value to sort by.
  if (!sortIsComputed) {
    pipeline.push({ $sort: Object.fromEntries(sortDefs.map((s) => [s.field.path, s.dir])) });
  }

  // Every field the filter/sort touches needs its join present too, even
  // one the admin didn't ask to SEE in the output — you can't filter or
  // sort on a value that was never computed.
  const filterFields = conditions.map((c) => fieldOrThrow(source, c.field));
  collectExtraStages([...chosenFields, ...filterFields, ...sortDefs.map((s) => s.field)], pipeline);

  if (lateMatch) pipeline.push({ $match: lateMatch });

  const projectStage = {};
  chosenFields.forEach((f) => {
    projectStage[f.key] = `$${f.path}`;
  });
  // A computed sort field has to survive $project under its own key even
  // when it isn't one of the columns the admin actually asked to see —
  // otherwise the $sort below would reference a key $project just
  // stripped out, and silently sort by `undefined` for every row.
  if (sortIsComputed) {
    sortDefs.forEach((s) => {
      if (!(s.field.key in projectStage)) projectStage[s.field.key] = `$${s.field.path}`;
    });
  }
  pipeline.push({ $project: projectStage });

  if (sortIsComputed) {
    pipeline.push({ $sort: Object.fromEntries(sortDefs.map((s) => [s.field.key, s.dir])) });
  }

  pipeline.push({
    $facet: {
      data: [{ $skip: (safePage - 1) * safePageSize }, { $limit: safePageSize }],
      totalCount: [{ $count: "count" }],
    },
  });

  const [result] = await source.model.aggregate(pipeline).allowDiskUse(true);
  const rows = result?.data ?? [];
  const total = result?.totalCount?.[0]?.count ?? 0;

  return {
    rows,
    total,
    page: safePage,
    pageSize: safePageSize,
    columns: chosenFields.map(({ key, label, type }) => ({ key, label, type })),
    grouped: false,
  };
}

/**
 * `grouping: { groupBy: fieldKey, aggregations: [{ field: fieldKey, fn: "sum"|"count"|"avg"|"min"|"max" }] }`
 * — one row per distinct Group By value, with each requested aggregation
 * as its own column. Sorting a grouped report always sorts the AGGREGATED
 * columns (or the group key itself), since that's the only thing left to
 * sort by once the underlying rows have been collapsed.
 */
async function runGroupedReport({ source, pipeline, lateMatch, grouping, sort, page, pageSize }) {
  if (!grouping.groupBy) throw "Choose a field to group by.";
  const groupField = fieldOrThrow(source, grouping.groupBy);
  const aggregations = Array.isArray(grouping.aggregations) ? grouping.aggregations : [];
  if (aggregations.length === 0) throw "Choose at least one aggregation (Sum, Count, Average, Min or Max) for a grouped report.";

  const aggFields = aggregations.map((a) => ({ ...a, fieldDef: a.fn === "count" ? null : fieldOrThrow(source, a.field) }));

  collectExtraStages([groupField, ...aggFields.map((a) => a.fieldDef).filter(Boolean)], pipeline);
  if (lateMatch) pipeline.push({ $match: lateMatch });

  const outputKey = (a) => `${a.field || "records"}__${a.fn}`;
  const groupStage = { _id: `$${groupField.path}` };
  aggFields.forEach((a) => {
    groupStage[outputKey(a)] = a.fn === "count" ? { $sum: 1 } : { [AGGREGATION_FUNCTIONS[a.fn]]: `$${a.fieldDef.path}` };
  });
  pipeline.push({ $group: groupStage });

  const projectStage = { _groupKey: "$_id" };
  aggFields.forEach((a) => {
    projectStage[outputKey(a)] = `$${outputKey(a)}`;
  });
  pipeline.push({ $project: { ...projectStage, _id: 0 } });

  const columns = [
    { key: "_groupKey", label: groupField.label, type: groupField.type },
    ...aggFields.map((a) => ({
      key: outputKey(a),
      label: `${AGGREGATION_LABELS[a.fn]} ${a.fn === "count" ? "records" : a.fieldDef.label}`,
      type: "number",
    })),
  ];

  const sortDefs = sort.length ? sort : [{ field: "_groupKey", dir: "asc" }];
  const sortSpec = Object.fromEntries(
    sortDefs.map((s) => {
      const key = s.field === grouping.groupBy ? "_groupKey" : s.field;
      if (!columns.some((c) => c.key === key)) throw `Can't sort a grouped report by "${s.field}" — it isn't part of this grouping.`;
      return [key, s.dir === "asc" ? 1 : -1];
    })
  );
  pipeline.push({ $sort: sortSpec });

  pipeline.push({
    $facet: {
      data: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
      totalCount: [{ $count: "count" }],
    },
  });

  const [result] = await source.model.aggregate(pipeline).allowDiskUse(true);
  const rows = result?.data ?? [];
  const total = result?.totalCount?.[0]?.count ?? 0;

  return { rows, total, page, pageSize, columns, grouped: true };
}

/** Same pipeline as runReport, minus $facet/paging — for the "export everything matching these filters" download. Capped so one export can't try to stream an unbounded dataset. */
const MAX_EXPORT_ROWS = 20000;

async function runReportForExport({ sourceKey, fieldKeys, conditions = [], grouping = null, sort = [] }) {
  const source = getReportSource(sourceKey); // validates sourceKey up front, before the shared runReport does it again
  if (!grouping && (!Array.isArray(fieldKeys) || fieldKeys.length === 0)) throw "Select at least one field to export.";

  const { rows, total, columns } = await runReport({
    sourceKey: source.key,
    fieldKeys,
    conditions,
    grouping,
    sort,
    page: 1,
    pageSize: MAX_EXPORT_ROWS,
  });

  return { rows, total, columns, truncated: total > MAX_EXPORT_ROWS };
}

module.exports = { runReport, runReportForExport, MAX_EXPORT_ROWS };
