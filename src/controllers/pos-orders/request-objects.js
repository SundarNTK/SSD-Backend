const Joi = require("joi");

/**
 * Validation schemas for the POS counter's own order/payment write routes.
 * Mirrors controllers/pos/request-objects.js's cart-line/paidAmount shapes
 * exactly (the cart itself hasn't changed) — only the order/booking/payment
 * write endpoints move to this module; catalogue/customer lookups stay on
 * controllers/pos, shared by both the POS and Admin booking trees.
 */

const devoteeSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).required(),
  nakshatra: Joi.string().trim().allow("", null).default(""),
});

const cartLineSchema = Joi.object({
  refType: Joi.string().valid("Item", "Service").required(),
  refId: Joi.string().hex().length(24).required(),
  quantity: Joi.number().integer().min(1).required(),
  deities: Joi.array().items(Joi.string().hex().length(24)).default([]),
  devotees: Joi.array().items(devoteeSchema).default([]),
}).required();

/**
 * How much of the order/booking's grandTotal is being collected right now.
 * Omitted entirely means "pay in full". See controllers/pos's own comment
 * on paidAmountSchema for the full rationale — unchanged here.
 */
const paidAmountSchema = Joi.number().min(0).precision(2).optional();

/**
 * POST /pos/booking/orders
 */
const createOrderSchema = Joi.object({
  customerId: Joi.string().hex().length(24).required(),
  lines: Joi.array().items(cartLineSchema).min(1).required(),
  paymentModeId: Joi.string().hex().length(24).required(),
  paidAmount: paidAmountSchema,
});

/**
 * POST /pos/booking/orders/:id/confirm
 */
const confirmOrderSchema = Joi.object({
  paymentReference: Joi.string().trim().allow("", null).default(null),
  paidAmount: paidAmountSchema,
});

/**
 * POST /pos/booking/bookings/:id/payments
 */
const recordPaymentSchema = Joi.object({
  amount: Joi.number().greater(0).precision(2).required(),
  paymentModeId: Joi.string().hex().length(24).allow(null).default(null),
});

module.exports = {
  cartLineSchema,
  createOrderSchema,
  confirmOrderSchema,
  recordPaymentSchema,
};
