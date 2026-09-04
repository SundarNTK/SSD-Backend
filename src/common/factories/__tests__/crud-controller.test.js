/**
 * makeCrudController's remove() — covers the referencedBy guard added on
 * top of the existing "find it, soft-delete it" behaviour. list/create/
 * update are exercised implicitly by every master's own test suite; this
 * file focuses on what's new here.
 */

const makeCrudController = require("../crud-controller");

const RECORD_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";

function mockQuery(result) {
  return {
    select: jest.fn(() => mockQuery(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function mockModel(doc) {
  return {
    notDeletedFilter: jest.fn((filter) => ({ isDeleted: false, ...filter })),
    findOne: jest.fn(() => mockQuery(doc)),
  };
}

describe("makeCrudController remove()", () => {
  it("soft-deletes normally when referencedBy is omitted", async () => {
    const softDelete = jest.fn(async () => {});
    const Model = mockModel({ _id: RECORD_ID, softDelete });
    const { remove } = makeCrudController(Model);

    await remove({ params: { id: RECORD_ID }, auth: { userId: "u1" } }, mockRes());

    expect(softDelete).toHaveBeenCalledWith("u1");
  });

  it("blocks the delete with 409 when a referencedBy entry finds a still-active mapped record", async () => {
    const softDelete = jest.fn(async () => {});
    const Model = mockModel({ _id: RECORD_ID, softDelete });
    const SubCategory = mockModel({ _id: "sub1" });
    const { remove } = makeCrudController(Model, {
      referencedBy: [{ model: SubCategory, field: "category", label: "Sub Category" }],
    });
    const res = mockRes();

    await remove({ params: { id: RECORD_ID }, auth: { userId: "u1" } }, res);

    expect(softDelete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Sub Category") }));
  });

  it("allows the delete once the only referencing record is itself already soft-deleted (notDeletedFilter excludes it)", async () => {
    const softDelete = jest.fn(async () => {});
    const Model = mockModel({ _id: RECORD_ID, softDelete });
    // SubCategory's findOne resolves null — simulating that the only row
    // that used to reference this record has isDeleted: true and so is
    // excluded by notDeletedFilter.
    const SubCategory = mockModel(null);
    const { remove } = makeCrudController(Model, {
      referencedBy: [{ model: SubCategory, field: "category", label: "Sub Category" }],
    });

    await remove({ params: { id: RECORD_ID }, auth: { userId: "u1" } }, mockRes());

    expect(softDelete).toHaveBeenCalledWith("u1");
  });

  it("still 404s when the record itself doesn't exist, without running any referencedBy check", async () => {
    const Model = mockModel(null);
    const SubCategory = mockModel({ _id: "sub1" });
    const { remove } = makeCrudController(Model, {
      referencedBy: [{ model: SubCategory, field: "category", label: "Sub Category" }],
    });
    const res = mockRes();

    await remove({ params: { id: RECORD_ID }, auth: {} }, res);

    expect(SubCategory.findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
