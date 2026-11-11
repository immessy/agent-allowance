import { describe, expect, it } from "vitest";
import { getUtcMonthWindow, isTimestampInUtcMonth } from "@/domain/month-window";

describe("UTC month window helper", () => {
  it("computes exact UTC month start and exclusive next-month boundary", () => {
    const window = getUtcMonthWindow(new Date("2026-11-11T15:30:00.000Z"));
    expect(window.startIso).toBe("2026-11-01T00:00:00.000Z");
    expect(window.endExclusiveIso).toBe("2026-12-01T00:00:00.000Z");
  });

  it("handles December rollover to January of next year", () => {
    const window = getUtcMonthWindow(new Date("2026-12-31T23:59:59.999Z"));
    expect(window.startIso).toBe("2026-12-01T00:00:00.000Z");
    expect(window.endExclusiveIso).toBe("2027-01-01T00:00:00.000Z");
  });

  it("does not count 23:59:59 UTC of previous month toward next month", () => {
    const novEnd = "2026-11-30T23:59:59.000Z";
    const decMidnight = "2026-12-01T00:00:00.000Z";
    const nowInDec = new Date("2026-12-01T00:00:00.000Z");
    const nowInNov = new Date("2026-11-30T23:59:59.000Z");

    expect(isTimestampInUtcMonth(novEnd, nowInNov)).toBe(true);
    expect(isTimestampInUtcMonth(novEnd, nowInDec)).toBe(false);
    expect(isTimestampInUtcMonth(decMidnight, nowInNov)).toBe(false);
    expect(isTimestampInUtcMonth(decMidnight, nowInDec)).toBe(true);
  });

  it("rejects invalid timestamps", () => {
    expect(() =>
      isTimestampInUtcMonth("not-a-date", new Date("2026-11-11T00:00:00.000Z"))
    ).toThrow();
    expect(() => getUtcMonthWindow(new Date("invalid"))).toThrow();
  });
});

