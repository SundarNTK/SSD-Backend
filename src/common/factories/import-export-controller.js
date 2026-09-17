const ExcelJS = require("exceljs");
const multer = require("multer");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const escapeRegex = require("../utils/escape-regex");
const { atomicCreateMany } = require("../utils/atomic-create-many");

const MAX_IMPORT_ROWS = 500;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MULTI_VALUE_SPLIT = /[,;]/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const okExt = /\.xlsx$/i.test(file.originalname || "");
    if (!okExt || file.mimetype !== XLSX_MIME) {
      return cb(new Error("Please upload the .xlsx file produced by the sample template."));
    }
    return cb(null, true);
  },
});

const cleanHeader = (header) => header.replace(/\*$/, "").trim();
const slug = (label) => label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function parseBoolean(rawValue) {
  if (typeof rawValue === "boolean") return rawValue;
  const v = String(rawValue).trim().toLowerCase();
  if (["true", "yes", "y", "1", "active"].includes(v)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(v)) return false;
  return undefined;
}

function parseDate(rawValue) {
  const d = rawValue instanceof Date ? rawValue : new Date(rawValue);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Builds the four endpoints every master's Excel import/export needs —
 * export, sample-template download, pre-insert validation ("scan"), and the
 * atomic commit — from one declarative `fields` list, the same way
 * `makeCrudController` builds list/create/update/remove from one Model.
 *
 * Wired for Deity, Category, Sub Category, Item, Service, Event, Hall,
 * Hall Category, Hall Purpose, Additional Service, Food Package and Food
 * Menu Item (see each controller's own `import-export-fields.js`).
 *
 * `fields` — one entry per importable column, in the order they should
 * appear in the sheet:
 *   { key, header, type, required, requiredIf, unique, minLength, maxLength,
 *     integer, min, default, helpText,
 *     // type: "ref" only:
 *     refModel, refLabelField, multi, storeAs,
 *     // type: "enum" only:
 *     values }
 *
 * `type` is one of:
 *   - "string" / "number" — plain scalar, optionally `unique` (checked
 *     case-insensitively, both within the file and against the database —
 *     matching every master's own `activeUniqueIndexOptions({ collation })`
 *     index).
 *   - "boolean" — accepts Yes/No, True/False, 1/0 (case-insensitive).
 *   - "date" — accepts an Excel date cell or a parseable date string.
 *   - "enum" — a fixed, non-database list (`values: string[]`) — e.g.
 *     Event's GST classification.
 *   - "ref" — resolved by exact (case-insensitive) match against the
 *     *currently active* records of `refModel`, so a value naming a
 *     deleted, deactivated, renamed, or misspelled option is rejected
 *     rather than silently pointing at nothing. `multi: true` accepts a
 *     comma/semicolon-separated list (Item/Service's Deity Mapping, Food
 *     Package's Menu Items) and resolves to an array. `storeAs: "label"`
 *     stores the matched label text itself rather than its _id — for a
 *     field that is master-backed for its dropdown but persisted as a
 *     plain string on the document (Item's Unit of Measure, sourced from
 *     the Unit master's `unitName` but stored as free text — see
 *     models/items and ItemPage.tsx's fetchUnitOptions comment).
 *
 * `requiredIf(resolvedSoFar)` — for a field whose requiredness depends on
 * an EARLIER field in this same `fields` array (e.g. Item/Service's
 * Printing Group is required only when Deity Mapping is off) — evaluated
 * against whatever has already been resolved so far, so the flag field
 * must be declared before the field(s) that key off it. Takes precedence
 * over a static `required`.
 *
 * `mapToDoc(resolved)` — override for a master whose import columns don't
 * map 1:1 onto the schema (Item/Service flatten Category+Sub Category into
 * a one-entry `categoryDetails` array; Food Package flattens a Menu Items
 * list into `{ menuItem, includedInPackage }` rows). Defaults to a plain
 * `{ [key]: resolved[key] }` spread.
 * `exportRow(doc)` / `exportPopulate` — matching override for the export
 * sheet when the same reshaping applies there too.
 * `validateRow(resolved, errors, raw)` — extra cross-field business rules
 * a flat field list can't express (e.g. Event's end date can't be before
 * its start date) — push onto `errors`, don't throw.
 */
function makeImportExportController(
  Model,
  {
    entityLabel,
    sheetName,
    fields,
    extraDefaults = {},
    sampleRows: sampleRowFactory,
    mapToDoc,
    exportRow,
    exportPopulate,
    validateRow,
  }
) {
  const refFields = fields.filter((f) => f.type === "ref");

  async function buildRefLookups() {
    const lookups = {};
    for (const f of refFields) {
      // `refExtraFilter` narrows the dropdown beyond "active, non-deleted" —
      // e.g. General Ledger's Group Level 1/2/3 all point at the same
      // GlGroup collection, distinguished only by its `level` field.
      const docs = await f.refModel
        .find(f.refModel.notDeletedFilter({ status: 1, ...(f.refExtraFilter || {}) }))
        .select(f.refLabelField)
        .sort({ [f.refLabelField]: 1 });
      const map = new Map();
      docs.forEach((d) => map.set(String(d[f.refLabelField]).trim().toLowerCase(), { _id: d._id, label: d[f.refLabelField] }));
      lookups[f.key] = { map, docs };
    }
    return lookups;
  }

  /**
   * Resolves one field of one row into `resolved`, pushing onto `errors` —
   * called in `fields` declaration order so `requiredIf` can see earlier
   * keys already sitting in `resolved`.
   */
  function resolveField(f, raw, resolved, errors, refLookups) {
    const rawValue = raw[f.key];
    const trimmed = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    const isEmpty = trimmed === undefined || trimmed === null || trimmed === "";
    const isRequired = typeof f.requiredIf === "function" ? Boolean(f.requiredIf(resolved)) : Boolean(f.required);

    if (f.type === "ref") {
      const lookup = refLookups[f.key];
      if (isEmpty) {
        if (isRequired) errors.push(`${cleanHeader(f.header)} is required.`);
        else if (f.multi) resolved[f.key] = [];
        return;
      }
      if (f.multi) {
        const parts = String(rawValue).split(MULTI_VALUE_SPLIT).map((s) => s.trim()).filter(Boolean);
        const ids = [];
        const labels = [];
        const unrecognised = [];
        parts.forEach((p) => {
          const match = lookup.map.get(p.toLowerCase());
          if (!match) unrecognised.push(p);
          else {
            ids.push(match._id);
            labels.push(match.label);
          }
        });
        if (unrecognised.length) {
          errors.push(
            `${cleanHeader(f.header)} has value(s) that aren't valid, active options: ${unrecognised.join(", ")}. Separate multiple values with commas, matching the dropdown list exactly.`
          );
        } else {
          resolved[f.key] = f.storeAs === "label" ? labels : ids;
          resolved[`${f.key}Label`] = labels.join(", ");
        }
        return;
      }
      const match = lookup.map.get(String(rawValue).trim().toLowerCase());
      if (!match) {
        errors.push(
          `${cleanHeader(f.header)} "${rawValue}" is not a valid, active option — it may have been renamed, deactivated, or deleted. Pick one of the dropdown values from the template.`
        );
      } else {
        resolved[f.key] = f.storeAs === "label" ? match.label : match._id;
        resolved[`${f.key}Label`] = match.label;
      }
      return;
    }

    if (isEmpty) {
      if (isRequired) {
        errors.push(`${cleanHeader(f.header)} is required.`);
        return;
      }
      if (f.type === "boolean") resolved[f.key] = f.default !== undefined ? f.default : false;
      else if (f.type === "date") resolved[f.key] = f.default !== undefined ? f.default : undefined;
      else resolved[f.key] = f.default !== undefined ? f.default : f.type === "number" ? 0 : "";
      return;
    }

    if (f.type === "boolean") {
      const parsed = parseBoolean(rawValue);
      if (parsed === undefined) errors.push(`${cleanHeader(f.header)} must be Yes/No or True/False.`);
      else resolved[f.key] = parsed;
      return;
    }

    if (f.type === "date") {
      const parsed = parseDate(rawValue);
      if (!parsed) errors.push(`${cleanHeader(f.header)} must be a valid date.`);
      else resolved[f.key] = parsed;
      return;
    }

    if (f.type === "enum") {
      const match = f.values.find((v) => v.toLowerCase() === String(rawValue).trim().toLowerCase());
      if (!match) errors.push(`${cleanHeader(f.header)} must be one of: ${f.values.join(", ")}.`);
      else resolved[f.key] = match;
      return;
    }

    if (f.type === "string") {
      const value = String(trimmed);
      if (f.minLength && value.length < f.minLength) errors.push(`${cleanHeader(f.header)} must be at least ${f.minLength} characters.`);
      if (f.maxLength && value.length > f.maxLength) errors.push(`${cleanHeader(f.header)} must be at most ${f.maxLength} characters.`);
      resolved[f.key] = value;
      return;
    }

    // f.type === "number"
    const num = Number(trimmed);
    if (Number.isNaN(num)) {
      errors.push(`${cleanHeader(f.header)} must be a number.`);
      return;
    }
    if (f.integer && !Number.isInteger(num)) errors.push(`${cleanHeader(f.header)} must be a whole number.`);
    if (f.min !== undefined && num < f.min) errors.push(`${cleanHeader(f.header)} must be ${f.min} or greater.`);
    resolved[f.key] = num;
  }

  /**
   * The single source of truth for "is this row good to insert" — run once
   * at /import/validate time (the scan) and again, unchanged, at
   * /import/commit time against whatever the admin actually kept. Running
   * it twice (rather than trusting the client's first-pass result) is what
   * catches a dropdown value someone deactivated or a duplicate someone
   * else inserted in the gap between opening the review screen and
   * confirming it.
   */
  async function validateRows(rawRows) {
    const refLookups = await buildRefLookups();
    const blockingIssues = [];
    refFields.forEach((f) => {
      if (f.required && refLookups[f.key].map.size === 0) {
        blockingIssues.push(`No active ${cleanHeader(f.header)} records exist yet — create at least one before importing ${entityLabel}s.`);
      }
    });

    // `validateRow` may be async (e.g. General Ledger's Group Level 2/3
    // chain-membership check queries GlGroup directly, the same way the
    // live create()/update() controller does) — Promise.all rather than a
    // plain .map() so that's actually awaited before a row is judged valid.
    const rows = await Promise.all(
      rawRows.map(async ({ rowNumber, raw }) => {
        const errors = [];
        const resolved = {};
        fields.forEach((f) => resolveField(f, raw, resolved, errors, refLookups));
        if (typeof validateRow === "function") await validateRow(resolved, errors, raw);
        return { rowNumber, raw, resolved, errors };
      })
    );

    // Uniqueness — within the file first, then against the database — for
    // every field marked `unique`, matching the case-insensitive collation
    // every master's own unique index already enforces.
    for (const f of fields.filter((x) => x.unique)) {
      const byValue = new Map(); // lowercased value -> rowNumbers[]
      rows.forEach((r) => {
        const v = r.resolved[f.key];
        if (!v) return;
        const k = String(v).toLowerCase();
        if (!byValue.has(k)) byValue.set(k, []);
        byValue.get(k).push(r.rowNumber);
      });

      for (const [, rowNumbers] of byValue) {
        if (rowNumbers.length <= 1) continue;
        rows.forEach((r) => {
          if (!rowNumbers.includes(r.rowNumber)) return;
          const others = rowNumbers.filter((n) => n !== r.rowNumber);
          r.errors.push(`Duplicate ${cleanHeader(f.header)} — also used on row ${others.join(", ")} in this file.`);
        });
      }

      const values = [...byValue.keys()];
      if (values.length) {
        const existing = await Model.find(
          Model.notDeletedFilter({ [f.key]: { $in: values.map((v) => new RegExp(`^${escapeRegex(v)}$`, "i")) } })
        ).select(f.key);
        const existingSet = new Set(existing.map((d) => String(d[f.key]).toLowerCase()));
        rows.forEach((r) => {
          const v = r.resolved[f.key];
          if (v && existingSet.has(String(v).toLowerCase())) {
            r.errors.push(`${cleanHeader(f.header)} "${v}" already exists in the system.`);
          }
        });
      }
    }

    rows.forEach((r) => {
      r.status = r.errors.length ? "error" : "valid";
    });
    return { rows, blockingIssues };
  }

  function summarize(rows, blockingIssues) {
    return {
      total: rows.length,
      valid: rows.filter((r) => r.status === "valid").length,
      invalid: rows.filter((r) => r.status === "error").length,
      blockingIssues,
    };
  }

  const toClientRow = (r) => ({ rowNumber: r.rowNumber, raw: r.raw, resolved: r.resolved, errors: r.errors, status: r.status });

  async function parseWorkbookRows(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets.find((ws) => ws.name === sheetName) || workbook.worksheets[0];
    if (!sheet) throw "The uploaded file has no worksheet to read.";

    const colIndexByKey = {};
    sheet.getRow(1).eachCell((cell, colNumber) => {
      const text = String(cell.value ?? "").replace(/\*$/, "").trim().toLowerCase();
      const field = fields.find((f) => cleanHeader(f.header).toLowerCase() === text);
      if (field) colIndexByKey[field.key] = colNumber;
    });

    const missingCols = fields.filter((f) => !(f.key in colIndexByKey));
    if (missingCols.length) {
      throw `This file is missing column(s): ${missingCols.map((f) => cleanHeader(f.header)).join(", ")}. Please re-download the sample template and re-fill it.`;
    }

    if (sheet.rowCount - 1 > MAX_IMPORT_ROWS) {
      throw `This file has more than ${MAX_IMPORT_ROWS} data rows. Please split it into smaller batches.`;
    }

    const rawRows = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const raw = {};
      let hasAnyValue = false;

      fields.forEach((f) => {
        const cell = row.getCell(colIndexByKey[f.key]);
        let value = cell.value;
        if (value && typeof value === "object" && !(value instanceof Date)) {
          if (Array.isArray(value.richText)) value = value.richText.map((t) => t.text).join("");
          else if ("result" in value) value = value.result;
          else if ("text" in value) value = value.text;
          else value = "";
        }
        if (value !== null && value !== undefined && String(value).trim() !== "") hasAnyValue = true;
        raw[f.key] = value === null || value === undefined ? "" : value;
      });

      if (hasAnyValue) rawRows.push({ rowNumber: r, raw });
    }

    if (rawRows.length === 0) throw "No data rows were found in the uploaded file.";
    return rawRows;
  }

  function buildDoc(resolved, userId) {
    const base =
      typeof mapToDoc === "function"
        ? mapToDoc(resolved)
        : Object.fromEntries(fields.map((f) => [f.key, resolved[f.key]]));
    return { ...extraDefaults, ...base, createdBy: userId || null };
  }

  function defaultExportRow(doc) {
    const row = {};
    fields.forEach((f) => {
      if (f.type === "ref") {
        row[f.key] = f.multi
          ? (doc[f.key] || []).map((x) => x?.[f.refLabelField] ?? x).filter(Boolean).join(", ")
          : doc[f.key]?.[f.refLabelField] ?? doc[f.key] ?? "";
      } else if (f.type === "boolean") {
        row[f.key] = doc[f.key] ? "Yes" : "No";
      } else if (f.type === "date") {
        row[f.key] = doc[f.key] ? new Date(doc[f.key]).toISOString().slice(0, 10) : "";
      } else {
        row[f.key] = doc[f.key] ?? "";
      }
    });
    return row;
  }

  // ---- GET /export — every active+inactive, non-deleted record as .xlsx ----
  async function exportList(req, res) {
    try {
      let query = Model.find(Model.notDeletedFilter()).sort({ createdAt: -1 });
      if (Array.isArray(exportPopulate)) {
        exportPopulate.forEach((p) => {
          query = query.populate(p);
        });
      } else {
        refFields.forEach((f) => {
          query = query.populate({ path: f.key, select: f.refLabelField });
        });
      }
      const docs = await query.exec();

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(sheetName);
      sheet.columns = [...fields.map((f) => ({ header: cleanHeader(f.header), key: f.key, width: Math.max(18, f.header.length + 4) })), { header: "Status", key: "__status", width: 12 }];
      sheet.getRow(1).font = { bold: true };

      docs.forEach((doc) => {
        const row = typeof exportRow === "function" ? exportRow(doc) : defaultExportRow(doc);
        row.__status = doc.status === 1 ? "Active" : "Inactive";
        sheet.addRow(row);
      });

      res.setHeader("Content-Type", XLSX_MIME);
      res.setHeader("Content-Disposition", `attachment; filename="${slug(entityLabel)}-export-${Date.now()}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      return exceptionHandler({ res, error });
    }
  }

  // ---- GET /import/template — headers + sample fill + dropdown validation ----
  async function downloadTemplate(req, res) {
    try {
      const refLookups = await buildRefLookups();

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(sheetName);
      sheet.columns = fields.map((f) => ({ header: f.header, key: f.key, width: Math.max(20, f.header.length + 6) }));
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C1527" } };
      });

      const samples = typeof sampleRowFactory === "function" ? sampleRowFactory(refLookups) : [];
      samples.forEach((sample) => sheet.addRow(sample));

      let lookupSheet = null;
      if (refFields.length) {
        lookupSheet = workbook.addWorksheet("Lookups");
        lookupSheet.state = "veryHidden";
      }

      refFields.forEach((f, idx) => {
        const { docs } = refLookups[f.key];
        lookupSheet.getCell(1, idx + 1).value = cleanHeader(f.header);
        docs.forEach((d, i) => {
          lookupSheet.getCell(i + 2, idx + 1).value = d[f.refLabelField];
        });

        const mainColIndex = fields.findIndex((x) => x.key === f.key) + 1;
        const mainColLetter = sheet.getColumn(mainColIndex).letter;
        const lookupColLetter = lookupSheet.getColumn(idx + 1).letter;
        const lastRow = Math.max(docs.length + 1, 2);
        for (let r = 2; r <= MAX_IMPORT_ROWS + 1; r++) {
          sheet.getCell(`${mainColLetter}${r}`).dataValidation = {
            type: "list",
            allowBlank: !f.required,
            formulae: [`Lookups!$${lookupColLetter}$2:$${lookupColLetter}$${lastRow}`],
            showErrorMessage: true,
            // A multi-value column expects comma-separated picks typed by
            // hand (Excel's list validation has no native multi-select), so
            // a combined value like "A, B" would never match any single
            // list entry — "stop" there would make the column unusable.
            // "warning" still shows the dropdown as a picking aid without
            // blocking a valid comma-separated entry.
            errorStyle: f.multi ? "warning" : "stop",
            errorTitle: "Invalid selection",
            error: f.multi
              ? `Pick from the active ${cleanHeader(f.header)} values — separate more than one with a comma.`
              : `Choose one of the active ${cleanHeader(f.header)} values from the dropdown — typed values that don't match exactly will be rejected on import.`,
          };
        }
      });

      // Boolean columns get a plain "Yes"/"No" in-cell dropdown too — an
      // inline two-item list needs no Lookups-sheet range, unlike the
      // dynamic, data-driven ref dropdowns above.
      fields.filter((f) => f.type === "boolean").forEach((f) => {
        const colIndex = fields.findIndex((x) => x.key === f.key) + 1;
        const colLetter = sheet.getColumn(colIndex).letter;
        for (let r = 2; r <= MAX_IMPORT_ROWS + 1; r++) {
          sheet.getCell(`${colLetter}${r}`).dataValidation = {
            type: "list",
            allowBlank: true,
            formulae: ['"Yes,No"'],
            showErrorMessage: true,
            errorStyle: "stop",
            errorTitle: "Invalid selection",
            error: `Choose Yes or No from the dropdown.`,
          };
        }
      });

      const infoSheet = workbook.addWorksheet("Instructions");
      infoSheet.getColumn(1).width = 110;
      const titleRow = infoSheet.addRow([`${entityLabel} Import — Instructions`]);
      titleRow.getCell(1).font = { bold: true, size: 14 };
      infoSheet.addRow([""]);
      infoSheet.addRow(["1. Fill one row per record on the first sheet, starting below the sample row(s)."]);
      infoSheet.addRow(["2. Columns marked * are required. Leave others blank to use their default."]);
      infoSheet.addRow(["3. Columns with a dropdown (list arrow when you click the cell) only accept one of the listed, currently-active values — free text that doesn't match exactly is rejected. Where a column allows more than one value, separate them with commas."]);
      infoSheet.addRow(["4. Codes and names must be unique — both within this file and against existing records."]);
      infoSheet.addRow(["5. Upload the file from the Import screen — it is scanned and shown to you for review before anything is saved."]);
      infoSheet.addRow([""]);
      infoSheet.addRow(["Column reference:"]).getCell(1).font = { bold: true };
      fields.forEach((f) => {
        infoSheet.addRow([`${cleanHeader(f.header)}${f.required ? " (required)" : " (optional)"} — ${f.helpText || ""}`]);
      });

      res.setHeader("Content-Type", XLSX_MIME);
      res.setHeader("Content-Disposition", `attachment; filename="${slug(entityLabel)}-import-template.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      return exceptionHandler({ res, error });
    }
  }

  // ---- POST /import/validate — scan the file, insert nothing ----
  function validateImport(req, res) {
    upload.single("file")(req, res, async (err) => {
      if (err) return exceptionHandler({ res, error: err.message, statusCode: 422 });
      if (!req.file) return exceptionHandler({ res, error: "Please attach a .xlsx file.", statusCode: 422 });

      try {
        const rawRows = await parseWorkbookRows(req.file.buffer);
        const { rows, blockingIssues } = await validateRows(rawRows);
        return responseHandler({
          res,
          response: { rows: rows.map(toClientRow), summary: summarize(rows, blockingIssues) },
        });
      } catch (error) {
        return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
      }
    });
  }

  // ---- POST /import/commit — re-validate exactly what was kept, then an all-or-nothing insert ----
  async function commitImport(req, res) {
    try {
      const submitted = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (submitted.length === 0) throw "No rows were submitted to import.";
      if (submitted.length > MAX_IMPORT_ROWS) throw `Cannot import more than ${MAX_IMPORT_ROWS} rows at once.`;

      const rawRows = submitted.map((r, i) => ({
        rowNumber: Number(r.rowNumber) || i + 2,
        raw: r.raw && typeof r.raw === "object" ? r.raw : {},
      }));

      // Re-run the exact same scan the review screen showed — never trust
      // the client's earlier "this row is valid" verdict, since a dropdown
      // option or a competing import could have changed underneath it.
      const { rows, blockingIssues } = await validateRows(rawRows);
      const invalid = rows.filter((r) => r.status === "error");

      if (invalid.length > 0) {
        return res.status(422).json({
          success: false,
          message: `${invalid.length} of ${rows.length} row(s) failed re-validation — nothing was imported. Review the highlighted rows below and try again.`,
          data: { rows: rows.map(toClientRow), summary: summarize(rows, blockingIssues) },
        });
      }

      const docs = rows.map((r) => buildDoc(r.resolved, req.auth?.userId));
      const inserted = await atomicCreateMany(Model, docs);

      return responseHandler({
        res,
        response: { insertedCount: inserted.length },
        successMessage: `${inserted.length} ${entityLabel}${inserted.length === 1 ? "" : "s"} imported successfully.`,
        statusCode: 201,
      });
    } catch (error) {
      return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
    }
  }

  return { exportList, downloadTemplate, validateImport, commitImport };
}

module.exports = { makeImportExportController, MAX_IMPORT_ROWS };
