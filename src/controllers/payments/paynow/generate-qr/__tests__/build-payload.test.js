const { buildPaynowQrPayload, crc16CcittFalse, tlv } = require("../build-payload");

const BASE_CONFIG = {
  merchantCategoryCode: "0000",
  currency: "702",
  countryCode: "SG",
  merchantName: "HINDU ENDOWMENTS BOARD",
  merchantCity: "Singapore",
  globalUniqueId: "SG.PAYNOW",
  proxyType: "2",
  proxyValue: "T08GB0016CH02",
  editableAmount: "1",
  pointOfInitiation: "12",
  amount: 175,
  referenceId: "POS23456789AB",
};

/**
 * Minimal TLV reader — just enough to pull specific top-level fields (and
 * one level of nesting for tag 26) back out of a built payload, so tests
 * can assert on structure without re-implementing the whole EMVCo parser.
 */
function readTlvFields(payload) {
  const fields = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    const value = payload.slice(i + 4, i + 4 + len);
    fields[id] = value;
    i += 4 + len;
  }
  return fields;
}

describe("tlv", () => {
  it("encodes id + zero-padded length + value", () => {
    expect(tlv("00", "01")).toBe("000201");
    expect(tlv("59", "HINDU ENDOWMENTS BOARD")).toBe("5922HINDU ENDOWMENTS BOARD");
  });
});

describe("crc16CcittFalse", () => {
  it("is deterministic and always 4 uppercase hex characters", () => {
    const a = crc16CcittFalse("000201");
    const b = crc16CcittFalse("000201");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9A-F]{4}$/);
  });

  it("produces different output for different input", () => {
    expect(crc16CcittFalse("000201")).not.toBe(crc16CcittFalse("000202"));
  });
});

describe("buildPaynowQrPayload", () => {
  it("starts with the Payload Format Indicator field", () => {
    const payload = buildPaynowQrPayload(BASE_CONFIG);
    expect(payload.startsWith("000201")).toBe(true);
  });

  it("ends with a CRC that matches an independent recomputation over everything before it", () => {
    const payload = buildPaynowQrPayload(BASE_CONFIG);
    const withoutCrcValue = payload.slice(0, -4); // includes the "6304" tag+length, excludes only the 4 CRC hex chars
    const expectedCrc = crc16CcittFalse(withoutCrcValue);
    expect(payload.slice(-4)).toBe(expectedCrc);
  });

  it("round-trips the top-level fields back out correctly", () => {
    const payload = buildPaynowQrPayload(BASE_CONFIG);
    const fields = readTlvFields(payload);

    expect(fields["00"]).toBe("01");
    expect(fields["01"]).toBe("12");
    expect(fields["52"]).toBe("0000");
    expect(fields["53"]).toBe("702");
    expect(fields["54"]).toBe("175.00");
    expect(fields["58"]).toBe("SG");
    expect(fields["59"]).toBe("HINDU ENDOWMENTS BOARD");
    expect(fields["60"]).toBe("Singapore");
    expect(fields["63"]).toHaveLength(4);
  });

  it("embeds the referenceId inside the Additional Data field (tag 62, sub-field 01)", () => {
    const payload = buildPaynowQrPayload(BASE_CONFIG);
    const fields = readTlvFields(payload);
    const additionalData = readTlvFields(fields["62"]);
    expect(additionalData["01"]).toBe("POS23456789AB");
  });

  it("embeds the PayNow proxy details inside the Merchant Account Info field (tag 26)", () => {
    const payload = buildPaynowQrPayload(BASE_CONFIG);
    const fields = readTlvFields(payload);
    const merchantAccountInfo = readTlvFields(fields["26"]);
    expect(merchantAccountInfo["00"]).toBe("SG.PAYNOW");
    expect(merchantAccountInfo["01"]).toBe("2");
    expect(merchantAccountInfo["02"]).toBe("T08GB0016CH02");
    expect(merchantAccountInfo["04"]).toMatch(/^\d{8}$/); // YYYYMMDD
  });

  it("omits the amount field entirely when no amount is given (an editable-amount QR)", () => {
    const payload = buildPaynowQrPayload({ ...BASE_CONFIG, amount: undefined });
    const fields = readTlvFields(payload);
    expect(fields["54"]).toBeUndefined();
  });

  it("truncates merchant name/city to the EMVCo-spec'd max lengths (25 / 15 chars)", () => {
    const payload = buildPaynowQrPayload({
      ...BASE_CONFIG,
      merchantName: "A".repeat(40),
      merchantCity: "B".repeat(30),
    });
    const fields = readTlvFields(payload);
    expect(fields["59"]).toHaveLength(25);
    expect(fields["60"]).toHaveLength(15);
  });
});
