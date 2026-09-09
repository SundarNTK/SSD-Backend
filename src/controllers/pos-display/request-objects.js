const Joi = require("joi");

const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

const lineSchema = Joi.object({
  name: Joi.string().trim().max(200).required(),
  quantity: Joi.number().min(0).required(),
  lineTotal: Joi.number().min(0).required(),
});

// One payment already collected against this booking (mode + amount) — see
// PosDisplayPaymentEntry on the frontend (lib/posDisplay.ts).
const paymentHistoryEntrySchema = Joi.object({
  mode: Joi.string().trim().max(40).required(),
  amount: Joi.number().min(0).required(),
});

const payloadSchema = Joi.object({
  phase: Joi.string().valid("idle", "cart", "collecting", "paynow", "terminal", "done").required(),
  customerName: Joi.string().trim().max(150).allow("", null),
  lines: Joi.array().items(lineSchema).max(80).default([]),
  grandTotal: Joi.number().min(0).default(0),
  payingNow: Joi.number().min(0).default(0),
  balanceDue: Joi.number().min(0).default(0),
  amountPaid: Joi.number().min(0).default(0),
  mode: Joi.string().trim().max(40).allow("", null),
  qrImage: Joi.string().allow("", null).max(2_000_000),
  referenceId: Joi.string().trim().max(80).allow("", null),
  bookingNumber: Joi.string().trim().max(40).allow("", null),
  paymentStatus: Joi.string().valid("paid", "partial", "pending").allow("", null),
  statusMessage: Joi.string().trim().max(200).allow("", null),
  // validateBody strips unknown keys by default (stripUnknown: true) —
  // without this field listed here explicitly, every paymentHistory entry
  // the frontend sends gets silently dropped before it's even saved.
  paymentHistory: Joi.array().items(paymentHistoryEntrySchema).max(50),
}).required();

const createSessionSchema = Joi.object({
  code: Joi.string().trim().uppercase().pattern(CODE_PATTERN).optional(),
});

const putPayloadSchema = Joi.object({
  payload: payloadSchema.required(),
});

module.exports = {
  CODE_PATTERN,
  createSessionSchema,
  putPayloadSchema,
};
