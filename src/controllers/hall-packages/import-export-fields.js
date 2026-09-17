const HallPurpose = require("../../models/hall-purposes");
const Hall = require("../../models/halls");
const AdditionalService = require("../../models/additional-services");

/**
 * Column definitions for Hall Package's Excel import/export — mirrors
 * request-objects.js's createSchema. `Halls` is a required (min 1),
 * comma-separated multi-select dropdown backed by the active Hall master;
 * `Additional Services` is the same but optional. Image and Terms &
 * Conditions (a long free-text block, awkward in a single cell) are
 * excluded — add those from the Edit form afterwards.
 */
const fields = [
  { key: "name", header: "Name*", type: "string", required: true, unique: true, maxLength: 150, helpText: "Hall Package name (max 150 characters)." },
  { key: "hallPurpose", header: "Hall Purpose*", type: "ref", required: true, refModel: HallPurpose, refLabelField: "name", helpText: "Must exactly match one of the active Hall Purposes." },
  {
    key: "halls",
    header: "Halls*",
    type: "ref",
    multi: true,
    required: true,
    refModel: Hall,
    refLabelField: "name",
    helpText: "At least one active Hall name, separated by commas. Booking this Package blocks every listed Hall together.",
  },
  { key: "standardSessionDuration", header: "Standard Session Duration (hrs)*", type: "number", required: true, min: 0.1, helpText: "Hours, greater than 0." },
  { key: "packagePrice", header: "Package Price*", type: "number", required: true, min: 0, helpText: "Package price, 0 or greater." },
  { key: "bookingAdvanceAmount", header: "Booking Advance Amount", type: "number", min: 0, default: 0, helpText: "Leave blank for 0." },
  { key: "depositAmount", header: "Deposit Amount", type: "number", min: 0, default: 0, helpText: "Leave blank for 0." },
  { key: "additionalHourRate", header: "Additional Hour Rate", type: "number", min: 0, default: 0, helpText: "Leave blank for 0." },
  { key: "gstApplicable", header: "GST Applicable", type: "boolean", default: false, helpText: "Yes/No. Defaults to No." },
  { key: "description", header: "Description", type: "string", required: false, helpText: "Optional description." },
  {
    key: "additionalServices",
    header: "Additional Services",
    type: "ref",
    multi: true,
    required: false,
    refModel: AdditionalService,
    refLabelField: "name",
    helpText: "Optional. Zero or more active Additional Service names, separated by commas.",
  },
];

function mapToDoc(resolved) {
  return {
    name: resolved.name,
    hallPurpose: resolved.hallPurpose,
    halls: resolved.halls || [],
    standardSessionDuration: resolved.standardSessionDuration,
    packagePrice: resolved.packagePrice,
    bookingAdvanceAmount: resolved.bookingAdvanceAmount,
    depositAmount: resolved.depositAmount,
    additionalHourRate: resolved.additionalHourRate,
    gstApplicable: resolved.gstApplicable,
    description: resolved.description,
    additionalServices: resolved.additionalServices || [],
  };
}

function exportRow(doc) {
  return {
    name: doc.name,
    hallPurpose: doc.hallPurpose?.name ?? "",
    halls: (doc.halls || []).map((h) => h?.name).filter(Boolean).join(", "),
    standardSessionDuration: doc.standardSessionDuration,
    packagePrice: doc.packagePrice,
    bookingAdvanceAmount: doc.bookingAdvanceAmount,
    depositAmount: doc.depositAmount,
    additionalHourRate: doc.additionalHourRate,
    gstApplicable: doc.gstApplicable ? "Yes" : "No",
    description: doc.description,
    additionalServices: (doc.additionalServices || []).map((s) => s?.name).filter(Boolean).join(", "),
  };
}

const exportPopulate = ["hallPurpose", "halls", "additionalServices"];

function sampleRows(refLookups) {
  const purposeName = refLookups.hallPurpose?.docs?.[0]?.name ?? "Your Hall Purpose Name";
  const hallNames = (refLookups.halls?.docs || []).slice(0, 2).map((d) => d.name);
  const serviceNames = (refLookups.additionalServices?.docs || []).slice(0, 1).map((d) => d.name);

  return [
    {
      name: "Standard Wedding Package",
      hallPurpose: purposeName,
      halls: hallNames.length ? hallNames.join(", ") : "Your Hall Name",
      standardSessionDuration: 4,
      packagePrice: 25000,
      bookingAdvanceAmount: 5000,
      depositAmount: 5000,
      additionalHourRate: 1500,
      gstApplicable: "No",
      description: "",
      additionalServices: serviceNames.join(", "),
    },
  ];
}

module.exports = { fields, mapToDoc, exportRow, exportPopulate, sampleRows };
