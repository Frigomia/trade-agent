import { describe, expect, it } from "vitest";
import type { CandidateFit, IdeaOut } from "@/lib/api/discovery-types";
import {
  ETF_GATE,
  cardFilterLine,
  correlationWords,
  effectivePositions,
  filterRows,
  filterSummary,
  fundTags,
  gapParts,
  isEtf,
  partsAgree,
  shortFundName,
  stripScale,
} from "@/lib/etfIdea";

function etf(name: string, fundamentals: Record<string, number | null> = { expenseRatio: 0.0018, fundSizeEur: 5.6e9 }): IdeaOut {
  return {
    ticker: "IMID",
    name,
    asset_type: "ETF",
    scores: [{ name: "fit", score: 44, reasons: [] }],
    overall: 44,
    confidence: "medium",
    risk: { market_cap_eur: null, avg_daily_value_eur: null, size_bucket: "unknown", volatility_annualized: null, max_drawdown_1y: null, risk_flags: [], risk_level: "unknown" },
    thesis: "",
    catalysts: [],
    outlook: "",
    bear_case: "",
    negative_developments: [],
    fit_summary: null,
    community_note: null,
    conclusion: "",
    sources: [],
    data_notes: [],
    snapshot: { exchange: "LSE", country: null, sector: null, industry: "Global Equity", currency: "USD", price: 30, price_as_of: null, fundamentals },
  };
}

const fit = (over: Partial<CandidateFit> = {}): CandidateFit => ({
  ticker: "IMID",
  applicable: true,
  avg_correlation_to_portfolio: 0.52,
  portfolio_vol_before: 0.151,
  portfolio_vol_after: 0.142,
  hhi_before: 0.21,
  hhi_after: 0.19,
  sector_weight_before: null,
  sector_weight_after: null,
  hypothetical_weight: 0.05,
  notes: [],
  ...over,
});

describe("ETF_GATE and isEtf", () => {
  it("qualifies ETF ideas at 50", () => expect(ETF_GATE).toBe(50));
  it("recognises an ETF by its asset type", () => {
    expect(isEtf(etf("Fund"))).toBe(true);
    expect(isEtf({ ...etf("Fund"), asset_type: "Stock" })).toBe(false);
  });
});

describe("shortFundName", () => {
  it("drops the share class and the UCITS ETF words", () => {
    expect(shortFundName("iShares Core MSCI EM IMI UCITS ETF (Acc)")).toBe("iShares Core MSCI EM IMI");
    expect(shortFundName("Vanguard FTSE All-World UCITS ETF USD Accumulation")).toBe("Vanguard FTSE All-World USD Accumulation");
    expect(shortFundName("Xtrackers MSCI World UCITS (Dist)")).toBe("Xtrackers MSCI World");
    expect(shortFundName("Amundi Index ETF")).toBe("Amundi Index");
  });
  it("leaves a plain name alone and never returns an empty string", () => {
    expect(shortFundName("SPDR Gold")).toBe("SPDR Gold");
    expect(shortFundName("ETF")).toBe("ETF");
    expect(shortFundName("(Acc)")).toBe("(Acc)");
  });
});

describe("fundTags", () => {
  it("lists only what the name shows", () => {
    expect(fundTags(etf("iShares Core MSCI EM IMI UCITS ETF (Acc)"))).toEqual(["ETF", "UCITS", "Acc"]);
    expect(fundTags(etf("Vanguard FTSE All-World UCITS ETF (Dist)"))).toEqual(["ETF", "UCITS", "Dist"]);
    expect(fundTags(etf("SPDR Gold"))).toEqual(["ETF"]);
    expect(fundTags(etf("Fund Accumulating"))).toEqual(["ETF", "Acc"]);
  });
});

describe("effectivePositions", () => {
  it("is one over the concentration", () => expect(effectivePositions(0.21)).toBeCloseTo(4.76, 2));
  it("is null without a usable concentration", () => {
    for (const v of [0, -1, null, undefined, Number.NaN, Infinity]) expect(effectivePositions(v)).toBeNull();
  });
});

describe("stripScale", () => {
  it("pads the span out to whole steps", () => {
    const vol = stripScale([0.151, 0.142], 0.01);
    expect(vol.min).toBeCloseTo(0.13, 5);
    expect(vol.max).toBeCloseTo(0.16, 5);
    expect(stripScale([4.76, 5.26], 1)).toEqual({ min: 4, max: 6 });
  });
  it("gives equal values a step-sized window", () => {
    const s = stripScale([0.15, 0.15], 0.01);
    expect(s.min).toBeCloseTo(0.14, 5);
    expect(s.max).toBeCloseTo(0.16, 5);
  });
  it("never returns a flat scale", () => {
    for (const [a, b] of [[5, 5.0001], [0.15, 0.15], [3, 3]]) {
      const s = stripScale([a, b], 1);
      expect(s.max).toBeGreaterThan(s.min);
    }
  });
});

describe("gapParts and partsAgree", () => {
  it("mirrors the backend formulas on a real fit", () => {
    const parts = gapParts(fit());
    expect(parts).toEqual({ volatility: 53, concentration: 55, correlation: 24 });
    expect(partsAgree(parts, 44)).toBe(true); // mean of 24, 53 and 55 is 44
    expect(partsAgree(parts, 45)).toBe(true);
    expect(partsAgree(parts, 72)).toBe(false);
  });
  it("scores a government-bond-like fund", () => {
    const parts = gapParts(fit({ avg_correlation_to_portfolio: -0.1, portfolio_vol_after: 0.142, portfolio_vol_before: 0.15, hhi_before: 0.2, hhi_after: 0.183 }));
    expect(parts).toEqual({ volatility: 53, concentration: 54, correlation: 55 });
    expect(partsAgree(parts, 54)).toBe(true);
  });
  it("clamps to 0..100", () => {
    expect(gapParts(fit({ avg_correlation_to_portfolio: -1.5 })).correlation).toBe(100);
    expect(gapParts(fit({ avg_correlation_to_portfolio: 3 })).correlation).toBe(0);
    expect(gapParts(fit({ portfolio_vol_after: 0.4 })).volatility).toBe(0);
  });
  it("is null where its inputs are missing or the baseline is not above 0", () => {
    expect(gapParts(null)).toEqual({ volatility: null, concentration: null, correlation: null });
    expect(gapParts(fit({ avg_correlation_to_portfolio: null })).correlation).toBeNull();
    expect(gapParts(fit({ portfolio_vol_before: 0 })).volatility).toBeNull();
    expect(gapParts(fit({ hhi_after: null })).concentration).toBeNull();
  });
  it("does not agree when a part is missing or the score is unsaved", () => {
    expect(partsAgree(gapParts(fit({ hhi_after: null })), 44)).toBe(false);
    expect(partsAgree(gapParts(fit()), null)).toBe(false);
  });
});

describe("correlationWords", () => {
  it("uses the proposed bands", () => {
    expect(correlationWords(0.2)).toBe("Moves mostly on its own");
    expect(correlationWords(-0.1)).toBe("Moves mostly on its own");
    expect(correlationWords(-0.4)).toBe("Tends to move against your holdings");
    expect(correlationWords(0.3)).toBe("Moves about half in step");
    expect(correlationWords(0.7)).toBe("Moves about half in step");
    expect(correlationWords(0.71)).toBe("Moves mostly with your holdings");
  });
});

describe("quality filter", () => {
  it("states six passing rows for a saved fund", () => {
    const rows = filterRows(etf("Fund"));
    expect(rows.map((r) => r.key)).toEqual(["cost", "size", "history", "plain", "near-copy", "overlap"]);
    expect(rows.map((r) => r.label)).toEqual(["Cost", "Size", "History", "Plain fund", "Cheapest of its kind", "No overlap with your ETFs"]);
    expect(rows.every((r) => r.state === "pass")).toBe(true);
    expect(rows[0].detail).toBe("Expense ratio 0.18% · at most 0.50%");
    expect(rows[1].detail).toBe("Fund size EUR 5.6B · at least EUR 100M");
    expect(rows[2].detail).toBe("At least 200 daily closes");
    expect(rows[3].detail).toBe("Not leveraged, inverse or a trading fund");
    expect(rows[4].detail).toBe("Not a near-copy of a cheaper fund in its category");
    expect(rows[5].detail).toBe("Not a near-copy of an ETF you hold (same category, correlation 0.95 or more)");
    expect(filterSummary(rows)).toBe("6 of 6 pass");
  });
  it("marks an unknown fund size", () => {
    const idea = etf("Fund", { expenseRatio: 0.0018 });
    const rows = filterRows(idea);
    expect(rows[1]).toMatchObject({ key: "size", state: "unknown", detail: "Fund size not saved · at least EUR 100M" });
    expect(filterSummary(rows)).toBe("5 pass · 1 unknown");
  });
  it("words the card line", () => {
    expect(cardFilterLine(etf("Fund"))).toBe("Quality filter passed: cost 0.18%, size EUR 5.6B, no overlap with your ETFs");
    expect(cardFilterLine(etf("Fund", { expenseRatio: 0.0018 }))).toBe("Quality filter: 5 passed, size unknown");
  });
});
