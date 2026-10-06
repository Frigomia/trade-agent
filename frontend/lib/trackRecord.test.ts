import { describe, it, expect } from "vitest";
import type { Action, RecommendationOut, RecommendationStatus } from "@/lib/api/recommendation-types";
import { buildTrackRecord } from "./trackRecord";

let nextId = 1;
function rec(
  action: Action,
  ret: number | null,
  overrides: Partial<RecommendationOut> = {},
): RecommendationOut {
  return {
    id: nextId++,
    user_id: "u1",
    created_at: "2026-08-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action,
    reasoning: [],
    ai_analysis: null,
    suggested_position_pct: null,
    status: "APPROVED" as RecommendationStatus,
    reviewed_at: null,
    fundamental_score: null,
    technical_signal: null,
    price_at_recommendation: 100,
    current_price: null,
    price_change_pct: null,
    outcome_forward_return_pct: ret,
    outcome_evaluated_at: "2026-08-25T00:00:00",
    ...overrides,
  };
}

describe("buildTrackRecord", () => {
  it("matches BUY and ADD on a positive move, TRIM and SELL on a negative one", () => {
    const { rows, matched, scored } = buildTrackRecord([
      rec("BUY", 0.05),
      rec("ADD", -0.02),
      rec("TRIM", -0.03),
      rec("SELL", 0.04),
    ]);
    expect(rows.map((r) => r.verdict)).toEqual(["matched", "missed", "matched", "missed"]);
    expect(matched).toBe(2);
    expect(scored).toBe(4);
  });

  it("never scores HOLD or WATCH", () => {
    const { rows, scored } = buildTrackRecord([rec("HOLD", 0.1), rec("WATCH", -0.1)]);
    expect(rows.map((r) => r.verdict)).toEqual(["unscored", "unscored"]);
    expect(scored).toBe(0);
  });

  it("treats a return of exactly zero as a miss", () => {
    const { rows } = buildTrackRecord([rec("BUY", 0), rec("SELL", 0)]);
    expect(rows.map((r) => r.verdict)).toEqual(["missed", "missed"]);
  });

  it("converts the stored fraction to a percentage", () => {
    const { rows } = buildTrackRecord([rec("BUY", 0.0525)]);
    expect(rows[0].movePct).toBeCloseTo(5.25);
  });

  it("scores dismissed calls too", () => {
    const { matched, scored } = buildTrackRecord([rec("BUY", 0.05, { status: "REJECTED" })]);
    expect(matched).toBe(1);
    expect(scored).toBe(1);
  });

  it("excludes superseded rows and rows not yet evaluated", () => {
    const { rows } = buildTrackRecord([
      rec("BUY", 0.05, { status: "SUPERSEDED" }),
      rec("BUY", null, { outcome_evaluated_at: null }),
      rec("BUY", 0.01),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("counts a scheduled recommendation like a manual one", () => {
    const { matched, scored } = buildTrackRecord([
      rec("BUY", 0.05, { source: "scheduled" }),
      rec("BUY", 0.05, { source: "manual" }),
    ]);
    expect(matched).toBe(2);
    expect(scored).toBe(2);
  });

  it("keeps a resolved row with no valid outcome as unscored", () => {
    const { rows, scored } = buildTrackRecord([rec("BUY", null)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("unscored");
    expect(rows[0].movePct).toBeNull();
    expect(scored).toBe(0);
  });

  it("sorts newest first and handles an empty list", () => {
    const { rows } = buildTrackRecord([
      rec("BUY", 0.01, { created_at: "2026-07-01T00:00:00" }),
      rec("BUY", 0.01, { created_at: "2026-08-15T00:00:00" }),
    ]);
    expect(rows[0].rec.created_at).toBe("2026-08-15T00:00:00");
    expect(buildTrackRecord([])).toEqual({ rows: [], matched: 0, scored: 0 });
  });
});
