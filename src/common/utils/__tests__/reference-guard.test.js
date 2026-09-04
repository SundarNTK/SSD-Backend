/**
 * findBlockingReference — the "don't delete a master that's still mapped
 * elsewhere" check every generic-factory master (and GST's own custom
 * remove) runs before soft-deleting. E.g. a Category can't be deleted while
 * a still-active Sub Category record points at it; once that Sub Category
 * is itself soft-deleted, the Category becomes deletable again.
 */

const { findBlockingReference } = require("../reference-guard");

const RECORD_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";

function mockModel(findOneResult) {
  return {
    notDeletedFilter: jest.fn((filter) => ({ isDeleted: false, ...filter })),
    findOne: jest.fn(() => ({ select: jest.fn(async () => findOneResult) })),
  };
}

describe("findBlockingReference", () => {
  it("returns null (nothing blocking) when referencedBy is empty", async () => {
    expect(await findBlockingReference([], RECORD_ID)).toBeNull();
    expect(await findBlockingReference(undefined, RECORD_ID)).toBeNull();
  });

  it("returns null when no referencing model has a still-active row pointing at this record", async () => {
    const SubCategory = mockModel(null);
    const result = await findBlockingReference([{ model: SubCategory, field: "category", label: "Sub Category" }], RECORD_ID);

    expect(result).toBeNull();
    expect(SubCategory.notDeletedFilter).toHaveBeenCalledWith({ category: RECORD_ID });
  });

  it("blocks with a message naming the referencing master when a still-active row is found", async () => {
    const SubCategory = mockModel({ _id: "sub1" });
    const result = await findBlockingReference([{ model: SubCategory, field: "category", label: "Sub Category" }], RECORD_ID);

    expect(result).toMatch(/still mapped to a Sub Category/);
  });

  it("only queries notDeletedFilter (excludes already soft-deleted referencing rows) — a deleted Sub Category no longer blocks", async () => {
    // The mock's findOne always resolves to null here, simulating that the
    // only matching row was excluded by notDeletedFilter's isDeleted: false.
    const SubCategory = mockModel(null);
    await findBlockingReference([{ model: SubCategory, field: "category", label: "Sub Category" }], RECORD_ID);

    expect(SubCategory.notDeletedFilter).toHaveBeenCalledWith(expect.objectContaining({ category: RECORD_ID }));
  });

  it("checks entries in order and stops at the first block, without querying the rest", async () => {
    const Item = mockModel({ _id: "item1" });
    const Service = mockModel(null);
    const result = await findBlockingReference(
      [
        { model: Item, field: "printingGroup", label: "Item" },
        { model: Service, field: "printingGroup", label: "Service" },
      ],
      RECORD_ID
    );

    expect(result).toMatch(/still mapped to a Item/);
    expect(Service.findOne).not.toHaveBeenCalled();
  });

  it("supports a dot-path field to reach into an array of subdocuments (e.g. Item.categoryDetails.category)", async () => {
    const Item = mockModel({ _id: "item1" });
    await findBlockingReference([{ model: Item, field: "categoryDetails.category", label: "Item" }], RECORD_ID);

    expect(Item.notDeletedFilter).toHaveBeenCalledWith({ "categoryDetails.category": RECORD_ID });
  });
});
