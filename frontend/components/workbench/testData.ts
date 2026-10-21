// Sample data for the workbench tests only; nothing in the app imports this file.
import type { Claim, DiscoveryRecommendation, IdeaOut, PriceHistory } from "@/lib/api/discovery-types";

export const claim = (over: Partial<Claim> = {}): Claim => ({
  text: "Revenue grew 12% in the quarter.",
  kind: "fact",
  stance: "bull",
  materiality: "high",
  source_tier: "official",
  url: "https://www.example.com/q3",
  published_at: "2026-10-01",
  ...over,
});

export const LONG_BEAR = "Top three customers are 38% of revenue. ".repeat(12) + "The final sentence of the risk.";

export function testIdea(over: Partial<IdeaOut> = {}): IdeaOut {
  return {
    ticker: "HLDN",
    name: "Halden Systems",
    asset_type: "STOCK",
    scores: [
      { name: "quality", score: 70, reasons: [] },
      { name: "valuation", score: 66, reasons: [] },
      { name: "fit", score: 61, reasons: [] },
    ],
    overall: 80,
    confidence: "high",
    risk: { market_cap_eur: null, avg_daily_value_eur: null, size_bucket: "large", volatility_annualized: null, max_drawdown_1y: null, risk_flags: [], risk_level: "medium" },
    thesis: "Recurring revenue and widening margins.",
    catalysts: ["Q3 results on 6 Nov."],
    outlook: "Margins should keep widening.",
    bear_case: LONG_BEAR,
    negative_developments: [
      { summary: "A key customer paused renewals.", occurred_on: "2026-09-12", evidence: [], thesis_impact: "Revenue growth could slow.", status: "disputed", invalidates_thesis: false },
    ],
    fit_summary: "It would add software exposure you do not have.",
    community_note: "Forum posts are positive.",
    conclusion: "c",
    sources: [
      claim(),
      claim({ stance: "bear", text: "Customer concentration is high.", url: "https://ledger.example/c", source_tier: "reliable_reporting", kind: "opinion" }),
      claim({ url: "javascript:alert(1)", text: "Odd link.", source_tier: "forum", kind: "forum", stance: "neutral" }),
    ],
    data_notes: ["Price date uncertain: the exchange did not report one."],
    snapshot: { exchange: "NASDAQ", country: "United States", sector: "Software", industry: "Infrastructure", currency: "USD", price: 184.2, price_as_of: "2026-10-19T20:00:00" },
    headline: "Recurring revenue priced below peers.",
    ...over,
  };
}

export function testRec(over: Partial<IdeaOut> = {}, id = 1): DiscoveryRecommendation {
  return {
    id,
    user_id: "u",
    created_at: "2026-10-20T06:12:00",
    ticker: "HLDN",
    asset_type: "STOCK",
    action: "BUY",
    source: "discovery",
    reasoning: [],
    ai_analysis: null,
    suggested_position_pct: null,
    status: "PENDING",
    reviewed_at: null,
    fundamental_score: null,
    technical_signal: null,
    price_at_recommendation: null,
    current_price: null,
    price_change_pct: 2.1,
    idea: testIdea(over),
  };
}

export function testHistory(n = 30, over: Partial<PriceHistory> = {}): PriceHistory {
  return {
    ticker: "HLDN",
    currency: "USD",
    as_of: "2026-10-19",
    range: "1y",
    points: Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), close: 150 + i })),
    ...over,
  };
}
