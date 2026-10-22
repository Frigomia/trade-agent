// Sample data for the workbench tests only; nothing in the app imports this file.
import type { Claim, DiscoveryRecommendation, IdeaOut, PeerComparison, PriceHistory } from "@/lib/api/discovery-types";

export const peer = (metric: string, over: Partial<PeerComparison> = {}): PeerComparison => ({
  metric,
  value: 0.2,
  peer_group: "industry",
  peer_count: 12,
  peer_median: 0.15,
  peer_p25: 0.1,
  peer_p75: 0.2,
  position: "above",
  ...over,
});

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
    risk: {
      market_cap_eur: 38_200_000_000,
      avg_daily_value_eur: 190_000_000,
      size_bucket: "large",
      volatility_annualized: 0.28,
      max_drawdown_1y: -0.12,
      risk_flags: ["thin_liquidity: 0.4M EUR traded a day"],
      risk_level: "medium",
    },
    peers: [
      peer("returnOnEquity", { value: 0.213, peer_median: 0.157, peer_p25: 0.1, peer_p75: 0.2, position: "above" }),
      peer("trailingPE", { value: 24.6, peer_median: 29.8, peer_p25: 22, peer_p75: 36, position: "within" }),
      peer("interestCoverage", { value: null, peer_median: null, peer_p25: null, peer_p75: null, position: "unavailable" }),
    ],
    competitors: ["Rival One Ltd"],
    thesis: "Recurring revenue and widening margins.",
    catalysts: ["Q3 results on 6 Nov."],
    outlook: "Margins should keep widening.",
    bear_case: LONG_BEAR,
    negative_developments: [
      { summary: "A key customer paused renewals.", occurred_on: "2026-09-12", evidence: [], thesis_impact: "Revenue growth could slow.", status: "disputed", invalidates_thesis: false },
    ],
    fit_summary: "It would add software exposure you do not have.",
    fit: {
      ticker: "HLDN",
      applicable: true,
      avg_correlation_to_portfolio: 0.31,
      portfolio_vol_before: 0.124,
      portfolio_vol_after: 0.118,
      hhi_before: 0.2,
      hhi_after: 0.186,
      sector_weight_before: 0.03,
      sector_weight_after: 0.07,
      hypothetical_weight: 0.05,
      notes: [],
    },
    community_note: "Forum posts are positive.",
    conclusion: "c",
    sources: [
      claim(),
      claim({ stance: "bear", text: "Customer concentration is high.", url: "https://ledger.example/c", source_tier: "reliable_reporting", kind: "opinion" }),
      claim({ url: "javascript:alert(1)", text: "Odd link.", source_tier: "forum", kind: "forum", stance: "neutral" }),
    ],
    data_notes: ["Price date uncertain: the exchange did not report one."],
    snapshot: {
      exchange: "NASDAQ",
      country: "United States",
      sector: "Software",
      industry: "Infrastructure",
      currency: "USD",
      price: 184.2,
      price_as_of: "2026-10-19T20:00:00",
      fundamentals: { returnOnEquity: 0.213, trailingPE: 24.6, debtToEquity: 1.4 },
      peers: [
        { ticker: "PEER1", name: "Peerco One", country: "Germany", currency: "EUR", market_cap_eur: 21_000_000_000, values: { returnOnEquity: 0.18, trailingPE: 31.2 } },
        { ticker: "PEER2", name: "Peerco Two", country: null, currency: null, market_cap_eur: null, values: { returnOnEquity: null, trailingPE: 27.5 } },
      ],
    },
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
