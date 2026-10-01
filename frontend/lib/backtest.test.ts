import { describe, it, expect } from "vitest";
import { defaultRange, excessLabel, signalRows, validateRun } from "./backtest";

const OK = { ticker: "AAPL", start: "2023-01-01", end: "2024-01-01" };

describe("validateRun", () => {
  it("accepts a normal run, From equal To, and lowercase tickers", () => {
    expect(validateRun(OK)).toBeNull();
    expect(validateRun({ ...OK, start: "2024-01-01", end: "2024-01-01" })).toBeNull();
    expect(validateRun({ ...OK, ticker: " aapl " })).toBeNull();
    expect(validateRun({ ...OK, ticker: "BRK.B" })).toBeNull();
  });

  it("rejects a bad ticker", () => {
    expect(validateRun({ ...OK, ticker: "" })).toMatch(/enter a ticker/i);
    expect(validateRun({ ...OK, ticker: "AAPL/../x" })).toMatch(/enter a ticker/i);
    expect(validateRun({ ...OK, ticker: "A".repeat(21) })).toMatch(/enter a ticker/i);
  });

  it("requires both dates and a sensible order", () => {
    expect(validateRun({ ...OK, start: "" })).toMatch(/start and an end date/i);
    expect(validateRun({ ...OK, end: "" })).toMatch(/start and an end date/i);
    expect(validateRun({ ...OK, start: "2024-02-01", end: "2024-01-01" })).toMatch(/must not be after/i);
  });

  it("allows exactly 30 years (10,950 days) and rejects one day more", () => {
    // 1990-01-01 + 10,950 days = 2019-12-25
    expect(validateRun({ ...OK, start: "1990-01-01", end: "2019-12-25" })).toBeNull();
    expect(validateRun({ ...OK, start: "1990-01-01", end: "2019-12-26" })).toMatch(/at most 30 years/i);
  });
});

describe("defaultRange", () => {
  it("ends today (UTC) and starts three years earlier", () => {
    expect(defaultRange(new Date("2026-09-30T23:30:00Z"))).toEqual({ start: "2023-09-30", end: "2026-09-30" });
  });
});

describe("excessLabel", () => {
  it("says ahead, behind or level, with a signed percentage", () => {
    expect(excessLabel(0.0266)).toBe("Ahead of buy-and-hold by +2.7%");
    expect(excessLabel(-0.01)).toBe("Behind buy-and-hold by -1.0%");
    expect(excessLabel(0)).toBe("Level with buy-and-hold");
    expect(excessLabel(0.0002)).toBe("Level with buy-and-hold");
  });
});

describe("signalRows", () => {
  it("converts fractions to percentages, labels signals, sorts by count and flags small samples", () => {
    const rows = signalRows({
      STRONG_UPTREND: { count: 12, avg_forward_return_pct: 0.0238, hit_rate: 0.65 },
      OVERSOLD: { count: 3, avg_forward_return_pct: -0.01, hit_rate: 0.3333 },
      MYSTERY: { count: 30, avg_forward_return_pct: 0, hit_rate: 0.5 },
    });
    expect(rows.map((r) => r.label)).toEqual(["Mystery", "Strong uptrend", "Oversold"]);
    expect(rows[1]).toMatchObject({ key: "STRONG_UPTREND", count: 12, small: false });
    expect(rows[1].avgMovePct).toBeCloseTo(2.38);
    expect(rows[1].risePct).toBeCloseTo(65);
    expect(rows[2].small).toBe(true);
  });

  it("turns an unknown signal key into a readable label", () => {
    const [row] = signalRows({ WEAK_UPTREND: { count: 7, avg_forward_return_pct: 0.01, hit_rate: 0.6 } });
    expect(row.label).toBe("Weak uptrend");
  });

  it("returns an empty list for no signals", () => {
    expect(signalRows({})).toEqual([]);
  });
});
