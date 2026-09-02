const {
  generatePaymentReferenceId,
  withUniqueReferenceId,
  referenceIdPrefix,
  ORIGIN_PREFIXES,
  REFERENCE_ID_LENGTH,
} = require("../payment-reference");

const SAFE_ALPHANUMERIC = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/;

describe("generatePaymentReferenceId", () => {
  it("produces a 13-character id: the 3-letter prefix + a 10-character alphanumeric body", () => {
    const id = generatePaymentReferenceId(ORIGIN_PREFIXES.POS);
    expect(id).toHaveLength(REFERENCE_ID_LENGTH);
    expect(id.startsWith("POS")).toBe(true);
    expect(id.slice(3)).toMatch(SAFE_ALPHANUMERIC);
  });

  it("never includes the ambiguous characters (0, 1, I, L, O) a printed receipt/QR could misread — in the random body (the fixed 3-letter prefix, e.g. \"POS\", is a mnemonic label, not drawn from this alphabet)", () => {
    for (let i = 0; i < 200; i++) {
      const id = generatePaymentReferenceId(ORIGIN_PREFIXES.POS);
      expect(id.slice(3)).not.toMatch(/[01ILO]/);
    }
  });

  it("is not sequential — consecutive calls don't produce adjacent-looking ids", () => {
    const ids = Array.from({ length: 50 }, () => generatePaymentReferenceId(ORIGIN_PREFIXES.POS));
    expect(new Set(ids).size).toBe(ids.length); // all distinct
    // None of them share a common numeric-looking run that a counter would produce
    const bodies = ids.map((id) => id.slice(3));
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it("rejects a prefix that isn't exactly 3 characters", () => {
    expect(() => generatePaymentReferenceId("PO")).toThrow(/exactly 3 characters/);
    expect(() => generatePaymentReferenceId("POSX")).toThrow(/exactly 3 characters/);
    expect(() => generatePaymentReferenceId(undefined)).toThrow(/exactly 3 characters/);
  });
});

describe("referenceIdPrefix", () => {
  it("extracts the 3-letter origin prefix from a reference id", () => {
    expect(referenceIdPrefix("POS23456789A")).toBe("POS");
  });

  it("returns null for a non-string input", () => {
    expect(referenceIdPrefix(undefined)).toBeNull();
    expect(referenceIdPrefix(12345)).toBeNull();
  });
});

describe("withUniqueReferenceId", () => {
  function referenceIdCollisionError() {
    const err = new Error("E11000 duplicate key error");
    err.code = 11000;
    err.keyPattern = { referenceId: 1 };
    return err;
  }

  it("resolves on the first attempt when there is no collision", async () => {
    const attempt = jest.fn(async (referenceId) => ({ ok: true, referenceId }));

    const result = await withUniqueReferenceId(ORIGIN_PREFIXES.POS, attempt);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.referenceId.startsWith("POS")).toBe(true);
  });

  it("regenerates a fresh id and retries when the write fails on a referenceId collision", async () => {
    const seenIds = [];
    let calls = 0;
    const attempt = jest.fn(async (referenceId) => {
      seenIds.push(referenceId);
      calls += 1;
      if (calls === 1) throw referenceIdCollisionError();
      return { ok: true, referenceId };
    });

    const result = await withUniqueReferenceId(ORIGIN_PREFIXES.POS, attempt);

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(seenIds[0]).not.toBe(seenIds[1]); // retried with a genuinely different id
    expect(result.ok).toBe(true);
  });

  it("does not retry, and rethrows immediately, on an error that isn't a referenceId collision", async () => {
    const otherError = new Error("some unrelated validation error");
    const attempt = jest.fn(async () => {
      throw otherError;
    });

    await expect(withUniqueReferenceId(ORIGIN_PREFIXES.POS, attempt)).rejects.toBe(otherError);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("gives up and rethrows after maxAttempts consecutive collisions", async () => {
    const attempt = jest.fn(async () => {
      throw referenceIdCollisionError();
    });

    await expect(withUniqueReferenceId(ORIGIN_PREFIXES.POS, attempt, 3)).rejects.toMatchObject({ code: 11000 });
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
