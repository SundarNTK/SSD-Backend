const Joi = require("joi");

/**
 * Validation schemas for all POS / Admin Booking request bodies.
 * Follows the same Joi pattern as the inventory controller's request-objects.js.
 */

const devoteeSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).required(),
  nakshatra: Joi.string().trim().allow("", null).default(""),
});

const cartLineSchema = Joi.object({
  refType: Joi.string().valid("Item", "Service").required(),
  refId: Joi.string().hex().length(24).required(),
  quantity: Joi.number().integer().min(1).required(),
  // For services: which deity ids this line is for
  deities: Joi.array().items(Joi.string().hex().length(24)).default([]),
  // Devotee names + nakshatras
  devotees: Joi.array().items(devoteeSchema).default([]),
}).required();

/**
 * POST /pos/booking/summary
 * Accepts the current cart lines and returns per-line pricing + totals
 * including live available-quantity information.
 */
const summarySchema = Joi.object({
  customerId: Joi.string().hex().length(24).required(),
  lines: Joi.array().items(cartLineSchema).min(1).required(),
});

/**
 * POST /pos/booking/orders
 * Creates an order record and places inventory reservations.
 */
const createOrderSchema = Joi.object({
  customerId: Joi.string().hex().length(24).required(),
  lines: Joi.array().items(cartLineSchema).min(1).required(),
  paymentModeId: Joi.string().hex().length(24).required(),
});

/**
 * POST /pos/booking/orders/:id/confirm
 * Confirms a pending order → creates a Booking, releases reservations
 * (marking them consumed), and writes permanent inventory Stock-Out rows.
 * No extra body for cash — this endpoint is the confirmation itself.
 */
const confirmOrderSchema = Joi.object({
  // Reserved for future online-payment receipt data (PayNow ref, etc.)
  // For cash the body may be empty or omitted entirely.
  paymentReference: Joi.string().trim().allow("", null).default(null),
});

/**
 * GET /pos/booking/customers/search
 * Quick customer lookup for the "Personal Details" section.
 * Accepts ?query=<mobile|email|name>
 */
const customerSearchSchema = Joi.object({
  query: Joi.string().trim().min(1).max(100).required(),
}).required();

module.exports = {
  summarySchema,
  createOrderSchema,
  confirmOrderSchema,
  customerSearchSchema,
};
