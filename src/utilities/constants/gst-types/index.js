/** Official GST Master types. */
const GST_TYPES = ["Standard Rated", "Zero-Rated", "Exempt", "Out of Scope"];

/** Older saved labels mapped onto the official names. */
const GST_TYPE_ALIASES = {
  "Standard GST": "Standard Rated",
};

const ZERO_RATE_TYPES = ["Zero-Rated", "Exempt", "Out of Scope"];

function canonicalGstType(type) {
  if (!type) return type;
  return GST_TYPE_ALIASES[type] || type;
}

function gstTypeMatchValues(type) {
  const canonical = canonicalGstType(type);
  const aliases = Object.entries(GST_TYPE_ALIASES)
    .filter(([, name]) => name === canonical)
    .map(([alias]) => alias);
  return [...new Set([canonical, type, ...aliases].filter(Boolean))];
}

function isOfficialType(type) {
  return GST_TYPES.includes(canonicalGstType(type));
}

function isZeroRateGstType(type) {
  return ZERO_RATE_TYPES.includes(canonicalGstType(type));
}

function isStandardRated(type) {
  return canonicalGstType(type) === "Standard Rated";
}

function validateGstPercentage(type, percentage) {
  if (!type || percentage === undefined || percentage === null || Number.isNaN(Number(percentage))) {
    return null;
  }
  const pct = Number(percentage);
  const name = canonicalGstType(type);
  if (isZeroRateGstType(name) && pct !== 0) {
    return `GST rate must be 0% for ${name}.`;
  }
  if (isStandardRated(name) && !(pct > 0 && pct <= 100)) {
    return "Standard Rated GST requires a configured rate greater than 0% (for example 9%).";
  }
  return null;
}

module.exports = {
  GST_TYPES,
  GST_TYPE_ALIASES,
  ZERO_RATE_TYPES,
  canonicalGstType,
  gstTypeMatchValues,
  isOfficialType,
  isZeroRateGstType,
  isStandardRated,
  validateGstPercentage,
};
