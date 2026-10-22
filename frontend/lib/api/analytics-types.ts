// Mirrors PortfolioExposure in backend/app/schemas_discovery.py (GET /portfolio/analytics): the
// open holdings valued in euro, with concentration, volatility and correlations. Weights are 0 to 1.
export interface AnalyticsPosition {
  ticker: string;
  name: string;
  value_eur: number;
  weight: number;
  currency: string;
  price: number;
  price_as_of: string | null;
  stale: boolean;
}

export interface AnalyticsExposure {
  label: string; // "Technology", "USD", "Japan"; "Unclassified" when unknown
  weight: number;
}

export interface PortfolioAnalytics {
  as_of: string;
  total_value_eur: number | null; // null: no holding could be valued
  positions: AnalyticsPosition[];
  by_sector: AnalyticsExposure[];
  by_industry: AnalyticsExposure[];
  by_country: AnalyticsExposure[];
  by_currency: AnalyticsExposure[];
  top_position_weight: number | null;
  hhi: number | null; // sum of squared weights, 0 to 1
  effective_n: number | null; // 1 / hhi: how many equal positions it is equivalent to
  volatility_annualized: number | null;
  // null: fewer than 60 overlapping days, so the pair cannot be estimated
  correlation: Record<string, Record<string, number | null>>;
  skipped: Record<string, string>; // ticker -> why it could not be valued
  notes: string[];
}
