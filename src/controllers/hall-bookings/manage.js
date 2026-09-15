const express = require("express");
const mongoose = require("mongoose");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const { checkHallAvailability } = require("../../common/utils/hall-availability");

const PaymentMode = require("../../models/payment-modes");
const { HallBooking } = require("../../models/hall-bookings");
const { HallBookingPayment } = require("../../models/hall-booking-payments");

const {
  computeBookingAmounts,
  sumPaidAmount,
  derivePaymentStatus,
  generateHallReceiptNumber,
  describeConflicts,
} = require("./index");

const {
  recordPaymentSchema,
  editPreviewSchema,
  rescheduleSchema,
  cancelSchema,
  refundSchema,
  depositSettlementSchema,
} = require("./request-objects");

const router = express.Router();

async function findActiveBooking(id) {
  if (!mongoose.isValidObjectId(id)) throw "Invalid booking ID.";
  const booking = await HallBooking.findOne(HallBooking.notDeletedFilter({ _id: id }));
  if (!booking) throw "Booking not found.";
  return booking;
}

/** Rebuilds the computeBookingAmounts() input from a booking's own frozen values, for edit-preview/edit — the Hall/Package and date/time are not editable here (see request-objects.js), only merged in on top. */
function baseAmountsInput(booking) {
  return {
    bookingType: booking.bookingType,
    hallId: booking.hall ? String(booking.hall) : undefined,
    hallPackageId: booking.hallPackage ? String(booking.hallPackage) : undefined,
    hallPurposeId: String(booking.hallPurpose),
    eventDate: booking.eventDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    foodRequired: booking.foodRequired,
    foodPackageId: booking.foodPackage ? String(booking.foodPackage) : undefined,
    paxCount: booking.paxCount ?? undefined,
    removedMenuItemIds: booking.foodMenuSnapshot.filter((m) => m.removed).map((m) => String(m.menuItem)),
    additionalMenuItems: booking.additionalFoodItems.map((m) => ({ menuItemId: String(m.menuItem), quantity: m.quantity })),
    additionalServiceIds: booking.additionalServices.map((s) => String(s.service)),
    discountPercentage: booking.discountPercentage,
  };
}

// ─── collect payment ──────────────────────────────────────────────────────────

async function recordPayment(req, res) {
  try {
    const booking = await findActiveBooking(req.params.id);
    if (booking.bookingStatus !== "confirmed") throw "Only confirmed bookings can receive payments.";

    const { error, value } = recordPaymentSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;
    const { amount, paymentModeId, paymentSubtype, referenceNo, remarks } = value;

    const paidSoFar = await sumPaidAmount(booking._id);
    const balance = +(booking.finalAmount - paidSoFar).toFixed(2);
    if (balance <= 0.005) throw "This booking is already fully paid.";
    if (amount > balance + 0.005) throw `Payment amount cannot exceed the outstanding balance of ${balance.toFixed(2)}.`;

    const mode = await PaymentMode.findOne(PaymentMode.notDeletedFilter({ _id: paymentModeId, status: 1 })).select("name");
    if (!mode) throw "Payment mode not found or inactive.";
    if (mode.name === "Other" && !remarks) throw "Remarks are required when Payment Mode is Other.";

    const receiptNo = await generateHallReceiptNumber();
    const payment = await HallBookingPayment.create({
      receiptNo,
      booking: booking._id,
      customer: booking.customer,
      paymentType: "balance",
      amount,
      paymentMode: mode._id,
      paymentModeName: mode.name,
      paymentSubtype,
      referenceNo,
      remarks,
      paymentDate: new Date(),
      collectedBy: req.auth?.userId || null,
    });

    booking.paymentStatus = derivePaymentStatus(paidSoFar + amount, booking.finalAmount);
    await booking.save();

    return responseHandler({ res, response: { booking, payment }, successMessage: "Payment recorded successfully." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
  }
}

// ─── edit (preview + apply) ───────────────────────────────────────────────────

async function editPreview(req, res) {
  try {
    const booking = await findActiveBooking(req.params.id);
    if (booking.bookingStatus !== "confirmed") throw "Only a confirmed booking can be edited.";

    const { error, value } = editPreviewSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;

    const merged = { ...baseAmountsInput(booking), ...value };
    const amounts = await computeBookingAmounts(merged);

    return responseHandler({
      res,
      response: {
        previous: { finalAmount: booking.finalAmount, subtotalAmount: booking.subtotalAmount, gstAmount: booking.gstAmount, discountAmount: booking.discountAmount },
        revised: {
          finalAmount: amounts.finalAmount,
          subtotalAmount: amounts.subtotalAmount,
          gstAmount: amounts.gstAmount,
          discountAmount: amounts.discountAmount,
        },
        adjustment: +(amounts.finalAmount - booking.finalAmount).toFixed(2),
      },
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
  }
}

async function applyEdit(req, res) {
  try {
    const booking = await findActiveBooking(req.params.id);
    if (booking.bookingStatus !== "confirmed") throw "Only a confirmed booking can be edited.";

    const { error, value } = editPreviewSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;

    const merged = { ...baseAmountsInput(booking), ...value };
    const amounts = await computeBookingAmounts(merged);

    booking.hallPurpose = merged.hallPurposeId;
    booking.hallPurposeName = amounts.hallPurposeName;
    booking.foodRequired = merged.foodRequired;
    booking.foodPackage = amounts.foodPackage?._id ?? null;
    booking.foodPackageName = amounts.foodPackage?.name ?? null;
    booking.paxCount = merged.paxCount ?? null;
    booking.foodMenuSnapshot = amounts.foodMenuSnapshot;
    booking.additionalFoodItems = amounts.additionalFoodItems;
    booking.additionalServices = amounts.additionalServicesSnapshot;
    booking.discountPercentage = merged.discountPercentage;
    booking.membershipNumber = merged.membershipNumber || "";
    booking.memberName = merged.memberName || "";
    if (value.remarks !== undefined) booking.remarks = value.remarks;

    booking.hallAmount = amounts.hallAmount;
    booking.foodAmount = amounts.foodAmount;
    booking.foodAdjustmentAmount = amounts.foodAdjustmentAmount;
    booking.additionalHourAmount = amounts.additionalHourAmount;
    booking.subtotalAmount = amounts.subtotalAmount;
    booking.discountAmount = amounts.discountAmount;
    booking.gstPercentage = amounts.gstPercentage;
    booking.gstAmount = amounts.gstAmount;
    booking.finalAmount = amounts.finalAmount;

    const paidSoFar = await sumPaidAmount(booking._id);
    booking.paymentStatus = derivePaymentStatus(paidSoFar, amounts.finalAmount);

    await booking.save();
    return responseHandler({ res, response: booking, successMessage: "Booking updated successfully." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
  }
}

// ─── reschedule ────────────────────────────────────────────────────────────────

async function reschedule(req, res) {
  try {
    const booking = await findActiveBooking(req.params.id);
    if (booking.bookingStatus !== "confirmed") throw "Only a confirmed booking can be rescheduled.";

    const { error, value } = rescheduleSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;
    const { eventDate, startTime, endTime, reason } = value;

    // The original reservation stays blocked until the new period is
    // confirmed available — if this fails, the booking below is left
    // completely untouched, satisfying the FSD's "original Booking shall
    // remain unchanged" rule.
    const availability = await checkHallAvailability({
      hallIds: booking.halls,
      eventDate,
      startTime,
      endTime,
      excludeBookingId: booking._id,
    });
    if (!availability.available) {
      return exceptionHandler({
        res,
        statusCode: 409,
        error: `This Hall is no longer available for the selected date and time. Please review the availability and try again.${describeConflicts(availability.conflicts)}`,
      });
    }

    booking.rescheduleHistory.push({
      previousEventDate: booking.eventDate,
      previousStartTime: booking.startTime,
      previousEndTime: booking.endTime,
      reason,
      rescheduledBy: req.auth?.userId || null,
      rescheduledAt: new Date(),
    });
    booking.eventDate = eventDate;
    booking.startTime = startTime;
    booking.endTime = endTime;

    await booking.save();
    return responseHandler({ res, response: booking, successMessage: "Booking rescheduled successfully." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
  }
}

// ─── cancel ─────────────────────────────────────────────────────────────────

async function cancelBooking(req, res) {
  try {
    const booking = await findActiveBooking(req.params.id);
    if (booking.bookingStatus !== "confirmed") throw "Only a confirmed booking can be cancelled.";

    const { error, value } = cancelSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;
    const { reason, cancellationCharge, remarks } = value;

    const amountPaid = await sumPaidAmount(booking._id);
    if (cancellationCharge > amountPaid + 0.005) throw "Cancellation charge cannot exceed the amount already paid.";
    const refundableAmount = +(amountPaid - cancellationCharge).toFixed(2);

    booking.bookingStatus = "cancelled"; // this alone frees the Hall — the availability query only ever matches "confirmed" bookings
    booking.cancellation = {
      reason,
      cancelledBy: req.auth?.userId || null,
      cancelledAt: new Date(),
      cancellationCharge,
      refundableAmount,
    };
    if (remarks) booking.remarks = `${booking.remarks ? booking.remarks + " | " : ""}${remarks}`;

    await booking.save();
    return responseHandler({ res, response: booking, successMessage: "Booking cancelled successfully." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
  }
}

// ─── refund ─────────────────────────────────────────────────────────────────

async function processRefund(req, res) {
  try {
    const booking = await findActiveBooking(req.params.id);
    if (booking.bookingStatus !== "cancelled") throw "Refunds can only be processed for a cancelled booking.";
    if (!booking.cancellation) throw "This booking has no cancellation record to refund against.";
    if (booking.refund?.status === "processed") throw "A refund has already been processed for this booking.";

    const { error, value } = refundSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;
    const { amount, mode, reference, remarks, status } = value;

    if (amount > booking.cancellation.refundableAmount + 0.005) {
      throw `Refund amount cannot exceed the eligible refundable amount of ${booking.cancellation.refundableAmount.toFixed(2)}.`;
    }

    booking.refund = {
      status,
      amount,
      mode,
      reference,
      remarks,
      processedBy: req.auth?.userId || null,
      processedAt: status === "processed" ? new Date() : null,
    };

    await booking.save();
    return responseHandler({ res, response: booking, successMessage: "Refund recorded successfully." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
  }
}

// ─── deposit settlement ───────────────────────────────────────────────────────

async function settleDeposit(req, res) {
  try {
    const booking = await findActiveBooking(req.params.id);
    if (booking.depositSettlement?.status === "returned") throw "The deposit for this booking has already been returned.";
    if (!booking.depositAmount) throw "This booking has no Deposit configured.";

    const { error, value } = depositSettlementSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;
    const { deduction, returnDate } = value;

    const depositPayments = await HallBookingPayment.find(
      HallBookingPayment.notDeletedFilter({ booking: booking._id, paymentType: "deposit" })
    ).select("amount");
    const depositPaid = +depositPayments.reduce((sum, p) => sum + p.amount, 0).toFixed(2);

    if (deduction > depositPaid + 0.005) throw "Deduction cannot exceed the Deposit actually paid.";

    booking.depositSettlement = {
      depositPaid,
      deduction,
      refundableDeposit: +(depositPaid - deduction).toFixed(2),
      returnDate,
      status: "returned",
      processedBy: req.auth?.userId || null,
    };

    await booking.save();
    return responseHandler({ res, response: booking, successMessage: "Deposit settled successfully." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
  }
}

// ─── mark completed ───────────────────────────────────────────────────────────

async function completeBooking(req, res) {
  try {
    const booking = await findActiveBooking(req.params.id);
    if (booking.bookingStatus === "cancelled") throw "A cancelled booking cannot be marked completed.";
    if (booking.bookingStatus === "completed") throw "This booking is already marked completed.";

    booking.bookingStatus = "completed";
    booking.completedBy = req.auth?.userId || null;
    booking.completedAt = new Date();

    await booking.save();
    return responseHandler({ res, response: booking, successMessage: "Booking marked as completed." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
  }
}

router.post("/hall-bookings/:id/payments", recordPayment);
router.post("/hall-bookings/:id/edit/preview", editPreview);
router.put("/hall-bookings/:id/edit", applyEdit);
router.post("/hall-bookings/:id/reschedule", reschedule);
router.post("/hall-bookings/:id/cancel", cancelBooking);
router.post("/hall-bookings/:id/refund", processRefund);
router.post("/hall-bookings/:id/deposit-settlement", settleDeposit);
router.post("/hall-bookings/:id/complete", completeBooking);

module.exports = router;
