const { PRICING_BASIS_VALUES } = require("../../models/food-menu-items");

/**
 * Column definitions for Food Menu Item's Excel import/export — mirrors
 * request-objects.js's createSchema. `itemCategory` is a free-text field on
 * this schema (not backed by its own master), so it stays a plain string
 * column, not a dropdown.
 */
const fields = [
  { key: "name", header: "Name*", type: "string", required: true, unique: true, maxLength: 150, helpText: "Menu item name (max 150 characters)." },
  { key: "itemCategory", header: "Item Category*", type: "string", required: true, maxLength: 100, helpText: "Free-text grouping, e.g. Starter, Main Course, Dessert." },
  { key: "description", header: "Description", type: "string", required: false, helpText: "Optional description." },
  { key: "pricingBasis", header: "Pricing Basis*", type: "enum", required: true, values: PRICING_BASIS_VALUES, helpText: `One of: ${PRICING_BASIS_VALUES.join(", ")}.` },
  { key: "cost", header: "Cost*", type: "number", required: true, min: 0, helpText: "Cost, 0 or greater." },
];

function sampleRows() {
  return [
    { name: "Briyani", itemCategory: "Main Course", description: "", pricingBasis: "per-pax", cost: 120 },
    { name: "Filter Coffee", itemCategory: "Beverage", description: "", pricingBasis: "per-unit", cost: 15 },
  ];
}

module.exports = { fields, sampleRows };
