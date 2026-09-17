const escapeRegex = require("../utils/escape-regex");

/**
 * The filter builder's operator catalog and condition-to-MongoDB
 * translation — kept separate from report-sources.js (the field catalog)
 * and report-runner.js (pipeline assembly) so each piece stays easy to
 * reason about on its own.
 *
 * A field with `options` set (see report-sources.js) is a dropdown/enum
 * field and gets the "equals/notEquals/in/notIn" operator set regardless
 * of its scalar `type`; every other field's operators come from its type.
 */
const OPERATORS_BY_TYPE = {
  string: ["equals", "notEquals", "contains", "startsWith", "endsWith", "isEmpty", "isNotEmpty"],
  number: ["equals", "notEquals", "gt", "lt", "gte", "lte", "between"],
  date: ["equals", "before", "after", "between", "today", "yesterday", "thisWeek", "thisMonth", "lastMonth"],
  boolean: ["equals"],
};
const OPTIONS_FIELD_OPERATORS = ["equals", "notEquals", "in", "notIn"];
const NO_VALUE_OPERATORS = ["isEmpty", "isNotEmpty", "today", "yesterday", "thisWeek", "thisMonth", "lastMonth"];
const TWO_VALUE_OPERATORS = ["between"];

function operatorsForField(field) {
  return field.options ? OPTIONS_FIELD_OPERATORS : OPERATORS_BY_TYPE[field.type] || OPERATORS_BY_TYPE.string;
}

function castValue(field, value) {
  if (value === null || value === undefined) return value;
  if (field.type === "number") return Number(value);
  if (field.type === "date") return new Date(value);
  if (field.type === "boolean") return value === true || value === "true" || value === "Yes" || value === "yes";
  return String(value);
}

/** Local-time day boundaries — a report filter means "the admin's day", not UTC midnight. */
function dayBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function dateShortcutRange(operator) {
  const now = new Date();
  if (operator === "today") return dayBounds(now);
  if (operator === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return dayBounds(y);
  }
  if (operator === "thisWeek") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    return { start: dayBounds(start).start, end: dayBounds(now).end };
  }
  if (operator === "thisMonth") {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: dayBounds(now).end };
  }
  if (operator === "lastMonth") {
    return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999) };
  }
  return null;
}

/**
 * One condition -> one MongoDB match fragment, keyed by the field's own
 * pipeline path. Throws a plain string (this codebase's convention for a
 * user-facing 4xx) for anything malformed, rather than silently building a
 * match that matches nothing or everything.
 */
function buildConditionMatch(field, operator, rawValue, rawValueTo) {
  const allowed = operatorsForField(field);
  if (!allowed.includes(operator)) {
    throw `"${operator}" is not a valid operator for "${field.label}".`;
  }

  const path = field.path;

  if (NO_VALUE_OPERATORS.includes(operator)) {
    if (operator === "isEmpty") return { $or: [{ [path]: null }, { [path]: "" }, { [path]: { $exists: false } }] };
    if (operator === "isNotEmpty") return { [path]: { $nin: [null, ""] } };
    const range = dateShortcutRange(operator);
    return { [path]: { $gte: range.start, $lte: range.end } };
  }

  if (TWO_VALUE_OPERATORS.includes(operator)) {
    if (rawValue === undefined || rawValue === null || rawValueTo === undefined || rawValueTo === null) {
      throw `"${field.label}" needs both a from and a to value for "between".`;
    }
    const from = castValue(field, rawValue);
    const to = field.type === "date" ? dayBounds(castValue(field, rawValueTo)).end : castValue(field, rawValueTo);
    return { [path]: { $gte: from, $lte: to } };
  }

  if (operator === "in" || operator === "notIn") {
    const list = Array.isArray(rawValue) ? rawValue : [rawValue];
    return { [path]: { [operator === "in" ? "$in" : "$nin"]: list.map((v) => castValue(field, v)) } };
  }

  if (rawValue === undefined || rawValue === null || rawValue === "") {
    throw `"${field.label}" needs a value for "${operator}".`;
  }
  const value = castValue(field, rawValue);

  switch (operator) {
    case "equals":
      return { [path]: value };
    case "notEquals":
      return { [path]: { $ne: value } };
    case "contains":
      return { [path]: { $regex: escapeRegex(String(value)), $options: "i" } };
    case "startsWith":
      return { [path]: { $regex: `^${escapeRegex(String(value))}`, $options: "i" } };
    case "endsWith":
      return { [path]: { $regex: `${escapeRegex(String(value))}$`, $options: "i" } };
    case "gt":
      return { [path]: { $gt: value } };
    case "lt":
      return { [path]: { $lt: value } };
    case "gte":
      return { [path]: { $gte: value } };
    case "lte":
      return { [path]: { $lte: value } };
    case "before":
      return { [path]: { $lt: value } };
    case "after":
      return { [path]: { $gt: dayBounds(value).end } };
    default:
      throw `"${operator}" is not supported.`;
  }
}

/**
 * Folds a flat list of conditions into one nested MongoDB match, left to
 * right — `logic` on condition[i] is the connector between it and
 * condition[i+1] (the last condition's `logic` is unused). This is a
 * left-to-right fold, NOT full boolean-precedence grouping: three
 * conditions joined "AND, OR" become `{$or: [{$and:[c1,c2]}, c3]}`, read
 * top-to-bottom the same way the filter rows read top-to-bottom. Explicit
 * parenthesized grouping isn't offered — every filter-row UI this mirrors
 * (Airtable's, Notion's, this app's own field list) reads the same way.
 */
function foldConditions(matches) {
  if (matches.length === 0) return null;
  let acc = matches[0].match;
  // The connector folding IN matches[i] is matches[i-1].logic — that field
  // means "how I join to whatever comes after me", so it's read off the
  // PRECEDING condition, not the one being folded in.
  for (let i = 1; i < matches.length; i++) {
    const op = matches[i - 1].logic === "OR" ? "$or" : "$and";
    acc = { [op]: [acc, matches[i].match] };
  }
  return acc;
}

/**
 * Builds the match for a list of {field: key, operator, value, valueTo, logic}
 * conditions against a source's field catalog, split into what can run
 * BEFORE a field's own join/computation stages (`earlyMatch`) versus what
 * has to wait until after them (`lateMatch`) — see report-runner.js for why
 * that split matters for performance. Correctness always wins over the
 * split: the moment ANY condition touches a computed field, the WHOLE
 * fold moves to `lateMatch` rather than trying to partially decompose a
 * mixed AND/OR tree across two pipeline stages.
 */
function buildFilterStages(source, conditions) {
  if (!conditions || conditions.length === 0) return { earlyMatch: null, lateMatch: null };

  const resolved = conditions.map((c) => {
    const field = source.fields.find((f) => f.key === c.field);
    if (!field) throw `"${source.label}" has no field "${c.field}" to filter on.`;
    return { field, match: buildConditionMatch(field, c.operator, c.value, c.valueTo), logic: c.logic };
  });

  const anyComputed = resolved.some((r) => typeof r.field.extraStages === "function");
  const folded = foldConditions(resolved);

  return anyComputed ? { earlyMatch: null, lateMatch: folded } : { earlyMatch: folded, lateMatch: null };
}

module.exports = { OPERATORS_BY_TYPE, OPTIONS_FIELD_OPERATORS, operatorsForField, buildFilterStages, buildConditionMatch };
