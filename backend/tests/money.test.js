const { parseDollarsToCents, centsToDollarString, splitEvenly } = require("../lib/money");

describe("parseDollarsToCents", () => {
  it("parses plain and decimal strings", () => {
    expect(parseDollarsToCents("10")).toBe(1000);
    expect(parseDollarsToCents("10.5")).toBe(1050);
    expect(parseDollarsToCents("10.50")).toBe(1050);
    expect(parseDollarsToCents("0.01")).toBe(1);
  });

  it("accepts a leading cedi symbol or code", () => {
    expect(parseDollarsToCents("GH₵12.50")).toBe(1250);
    expect(parseDollarsToCents("₵ 5")).toBe(500);
    expect(parseDollarsToCents("GHS30")).toBe(3000);
    expect(parseDollarsToCents("GH₵")).toBeNull();
  });

  it("accepts a leading dollar sign and numbers", () => {
    expect(parseDollarsToCents("$12.34")).toBe(1234);
    expect(parseDollarsToCents(12.5)).toBe(1250);
  });

  it("rejects zero, negative, non-numeric, and over-precise input", () => {
    expect(parseDollarsToCents("0")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("12.455")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents(null)).toBeNull();
    expect(parseDollarsToCents(NaN)).toBeNull();
  });

  it("rejects amounts over the sanity cap", () => {
    expect(parseDollarsToCents("2000000")).toBeNull();
  });
});

describe("centsToDollarString", () => {
  it("formats cents back to a dollar string", () => {
    expect(centsToDollarString(1000)).toBe("10.00");
    expect(centsToDollarString(1)).toBe("0.01");
    expect(centsToDollarString(0)).toBe("0.00");
    expect(centsToDollarString(-150)).toBe("-1.50");
  });
});

describe("splitEvenly", () => {
  it("splits a total that divides evenly", () => {
    const shares = splitEvenly(900, [1, 2, 3]);
    expect([...shares.values()]).toEqual([300, 300, 300]);
  });

  it("distributes the remainder one cent at a time, in participant order", () => {
    // $10.00 / 3 = 333.33... -> 334, 333, 333
    const shares = splitEvenly(1000, [1, 2, 3]);
    expect(shares.get(1)).toBe(334);
    expect(shares.get(2)).toBe(333);
    expect(shares.get(3)).toBe(333);
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("always sums to exactly the total, for many participant counts", () => {
    for (let n = 1; n <= 11; n++) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const total = 100000; // $1000.00
      const shares = splitEvenly(total, ids);
      const sum = [...shares.values()].reduce((a, b) => a + b, 0);
      expect(sum).toBe(total);
    }
  });

  it("gives one person the whole amount when there's only one participant", () => {
    const shares = splitEvenly(1234, [7]);
    expect(shares.get(7)).toBe(1234);
  });

  it("rejects a non-positive or non-integer total", () => {
    expect(() => splitEvenly(0, [1])).toThrow();
    expect(() => splitEvenly(-5, [1])).toThrow();
    expect(() => splitEvenly(10.5, [1])).toThrow();
  });

  it("rejects an empty participant list", () => {
    expect(() => splitEvenly(100, [])).toThrow();
  });
});
