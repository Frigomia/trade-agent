import { describe, expect, it } from "vitest";
import { decisionStamp, moveSinceRecommended } from "./decisionView";

const move = (price_at_recommendation: number | null, current_price: number | null) =>
  moveSinceRecommended({ price_at_recommendation, current_price });

describe("moveSinceRecommended", () => {
  it("computes the percent move to one decimal", () => {
    expect(move(100, 112.34)).toBe(12.3);
    expect(move(200, 190)).toBe(-5);
    expect(move(100, 100)).toBe(0);
  });

  it("is null when the price at recommendation is missing, zero or negative", () => {
    expect(move(null, 100)).toBeNull();
    expect(move(0, 100)).toBeNull();
    expect(move(-5, 100)).toBeNull();
  });

  it("is null when the current price is missing or not finite", () => {
    expect(move(100, null)).toBeNull();
    expect(move(100, 0)).toBeNull(); // a zero quote is a missing one, not a -100% fall
    expect(move(100, -1)).toBeNull();
    expect(move(100, Number.NaN)).toBeNull();
    expect(move(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("never returns NaN or Infinity", () => {
    for (const [a, b] of [[Number.NaN, 1], [1, Number.NaN], [0, 0], [Number.POSITIVE_INFINITY, 1], [1e-320, 1e308]] as const) {
      const r = move(a, b);
      expect(r === null || Number.isFinite(r)).toBe(true);
    }
  });
});

describe("decisionStamp", () => {
  it("decisionStamp is null without a review date", () => {
    expect(decisionStamp({ reviewed_at: null })).toBeNull();
  });

  it("shows the viewer's local day for a timestamp near midnight", () => {
    const t = new Date(2026, 9, 21, 0, 30); // local 00:30 on 21 Oct, whatever the zone
    expect(decisionStamp({ reviewed_at: t.toISOString().slice(0, 19) })).toBe(
      t.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }), // the local 21st, in the viewer's locale
    );
  });
});
