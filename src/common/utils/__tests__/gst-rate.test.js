/**
 * resolveGstRate — the one place "which GST rate applies" gets decided.
 * A GL account picks a GST Type; this resolves the actual percentage by
 * matching that type against whichever GST Master record's effective date
 * range covers the given document date.
 */

jest.mock("../../../models/gst");

const Gst = require("../../../models/gst");
const { resolveGstRate } = require("../gst-rate");

function mockFindOne(result) {
  Gst.findOne.mockReturnValue({ sort: jest.fn(async () => result) });
}

describe("resolveGstRate", () => {
  afterEach(() => jest.clearAllMocks());

  it("returns 0 when no GST type is given", async () => {
    expect(await resolveGstRate(null)).toBe(0);
    expect(await resolveGstRate(undefined)).toBe(0);
    expect(Gst.findOne).not.toHaveBeenCalled();
  });

  it.each(["Zero-Rated", "Exempt", "Out of Scope", "NA"])(
    "returns 0 for zero-rate type %s without querying the GST Master",
    async (type) => {
      expect(await resolveGstRate(type)).toBe(0);
      expect(Gst.findOne).not.toHaveBeenCalled();
    }
  );

  it("resolves the active Standard Rated record whose date range covers the document date", async () => {
    mockFindOne({ percentage: 9 });
    const documentDate = new Date("2026-09-20");

    const rate = await resolveGstRate("Standard Rated", documentDate);

    expect(rate).toBe(9);
    expect(Gst.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        isDeleted: false,
        status: 1,
        type: { $in: expect.arrayContaining(["Standard Rated"]) },
        effectiveStartDate: { $lte: documentDate },
      })
    );
  });

  it("returns 0 when Standard Rated has no record covering that document date (a genuine config gap, never blocks the sale)", async () => {
    mockFindOne(null);
    expect(await resolveGstRate("Standard Rated", new Date("2026-09-09"))).toBe(0);
  });

  it("normalizes an aliased type (\"Standard GST\") before matching", async () => {
    mockFindOne({ percentage: 8 });
    await resolveGstRate("Standard GST", new Date("2026-01-01"));
    expect(Gst.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ type: { $in: expect.arrayContaining(["Standard Rated"]) } })
    );
  });

  it("defaults documentDate to now when not given", async () => {
    mockFindOne({ percentage: 9 });
    await resolveGstRate("Standard Rated");
    const filter = Gst.findOne.mock.calls[0][0];
    expect(filter.effectiveStartDate.$lte).toBeInstanceOf(Date);
  });
});
