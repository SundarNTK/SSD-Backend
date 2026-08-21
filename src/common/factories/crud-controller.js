const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const escapeRegex = require("../utils/escape-regex");

/**
 * Every master (Email Template, Email Template Mapping today; Role, Entity,
 * and the rest from Day 2 onward) needs the same four operations —
 * paginated/search list, create, update, soft-delete. Generate them once
 * per model instead of hand-writing the same four functions per master.
 */
function makeCrudController(Model, { searchFields = [], populate = [] } = {}) {
  async function list(req, res) {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
      const filter = Model.notDeletedFilter();

      if (req.query.status !== undefined) filter.status = Number(req.query.status);

      if (req.query.search && searchFields.length > 0) {
        const regex = new RegExp(escapeRegex(req.query.search.trim()), "i");
        filter.$or = searchFields.map((field) => ({ [field]: regex }));
      }

      let query = Model.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize);
      populate.forEach((p) => { query = query.populate(p); });

      const [items, total] = await Promise.all([query.exec(), Model.countDocuments(filter)]);

      return responseHandler({ res, response: { items, total, page, pageSize } });
    } catch (error) {
      return exceptionHandler({ res, error });
    }
  }

  async function create(req, res) {
    try {
      const doc = await Model.create({ ...req.body, createdBy: req.auth?.userId || null });
      return responseHandler({ res, response: doc, successMessage: "Created successfully.", statusCode: 201 });
    } catch (error) {
      if (error?.code === 11000) {
        return exceptionHandler({ res, error: "A record with this value already exists.", statusCode: 409 });
      }
      return exceptionHandler({ res, error });
    }
  }

  async function update(req, res) {
    try {
      const doc = await Model.findOneAndUpdate(
        Model.notDeletedFilter({ _id: req.params.id }),
        { ...req.body, updatedBy: req.auth?.userId || null },
        { new: true, runValidators: true }
      );
      if (!doc) throw "Record not found.";
      return responseHandler({ res, response: doc, successMessage: "Updated successfully." });
    } catch (error) {
      return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
    }
  }

  async function remove(req, res) {
    try {
      const doc = await Model.findOne(Model.notDeletedFilter({ _id: req.params.id }));
      if (!doc) throw "Record not found.";
      await doc.softDelete(req.auth?.userId);
      return responseHandler({ res, successMessage: "Deactivated successfully." });
    } catch (error) {
      return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
    }
  }

  return { list, create, update, remove };
}

module.exports = makeCrudController;