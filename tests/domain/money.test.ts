import { describe, expect, it } from "vitest";
import {
  addCents,
  assertIntegerCents,
  formatCentsToDecimal,
  formatCentsToUsd,
  multiplyCents,
  parseUsdToCents,
  subtractCents,
} from "@/domain/money";

describe("money utilities", () => {
  it("parses valid USD strings to integer cents without float drift", () => {
    expect(parseUsdToCents("0")).toBe(0);
    expect(parseUsdToCents("$0.00")).toBe(0);
    expect(parseUsdToCents("24")).toBe(2400);
    expect(parseUsdToCents("$24")).toBe(2400);
    expect(parseUsdToCents("$24.00")).toBe(2400);
    expect(parseUsdToCents("19.99")).toBe(1999);
    expect(parseUsdToCents("50.01")).toBe(5001);
    expect(parseUsdToCents("1,234.56")).toBe(123456);
    expect(parseUsdToCents("$150.5")).toBe(15050);
    expect(parseUsdToCents("-$12.34")).toBe(-1234);
    expect(parseUsdToCents("-12.34")).toBe(-1234);
  });

  it("rejects invalid USD strings", () => {
    expect(() => parseUsdToCents("")).toThrow();
    expect(() => parseUsdToCents("abc")).toThrow();
    expect(() => parseUsdToCents("12.345")).toThrow();
    expect(() => parseUsdToCents("EUR 10.00")).toThrow();
    expect(() => parseUsdToCents("12.")).toThrow();
    expect(() => parseUsdToCents("12,34.56")).toThrow();
  });

  it("formats integer cents to USD and decimal strings and round-trips", () => {
    expect(formatCentsToUsd(0)).toBe("$0.00");
    expect(formatCentsToUsd(2400)).toBe("$24.00");
    expect(formatCentsToUsd(5001)).toBe("$50.01");
    expect(formatCentsToUsd(1999)).toBe("$19.99");
    expect(formatCentsToUsd(-505)).toBe("-$5.05");
    expect(formatCentsToUsd(123456)).toBe("$1,234.56");

    expect(formatCentsToDecimal(2400)).toBe("24.00");
    expect(formatCentsToDecimal(5)).toBe("0.05");
    expect(formatCentsToDecimal(123456)).toBe("1234.56");

    for (const cents of [0, 1, 99, 100, 1999, 5001, 15000, 123456]) {
      expect(parseUsdToCents(formatCentsToUsd(cents))).toBe(cents);
      expect(parseUsdToCents(formatCentsToDecimal(cents))).toBe(cents);
    }
  });

  it("rejects non-integer cents in assertions and formatting", () => {
    expect(() => assertIntegerCents(12.5)).toThrow();
    expect(() => assertIntegerCents(Number.NaN)).toThrow();
    expect(() => assertIntegerCents(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => formatCentsToUsd(12.34)).toThrow();
    expect(() => formatCentsToDecimal(12.34)).toThrow();
  });

  it("performs safe integer arithmetic on cents", () => {
    expect(addCents(2400, 8900)).toBe(11300);
    expect(subtractCents(15000, 11300)).toBe(3700);
    expect(multiplyCents(3000, 2)).toBe(6000);
    expect(multiplyCents(1999, 3)).toBe(5997);

    expect(() => addCents(10.5, 100)).toThrow();
    expect(() => subtractCents(100, 10.5)).toThrow();
    expect(() => multiplyCents(1000, 1.5)).toThrow();
    expect(() => addCents(Number.MAX_SAFE_INTEGER, 1)).toThrow();
  });
});
