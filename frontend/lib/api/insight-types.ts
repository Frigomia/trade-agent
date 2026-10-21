// Mirrors WatchlistInsightOut and WatchlistInsightsOut in backend/app/schemas.py (GET /portfolio/insights).
export interface WatchlistInsight {
  ticker: string;
  kind: "in_target_range";
  text: string; // a fact, never advice
  current_price: number;
  target_price_low: number;
  target_price_high: number;
}

export interface WatchlistInsights {
  insights: WatchlistInsight[];
  // What could not be looked up, so an absent insight is not read as "outside the range".
  missing: "prices"[];
}
