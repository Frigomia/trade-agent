export type AssetType = "ETF" | "STOCK";
export type TradeAction = "BUY" | "SELL";

export interface HoldingSummary {
  ticker: string;
  name: string;
  asset_type: AssetType;
  shares: number;
  cost_basis: number; // average cost per share
  first_purchase_date: string; // "2024-01-01"
  sector: string | null;
  target_weight: number | null;
  current_price: number | null;
  market_value: number | null;
  unrealized_pl: number | null;
  unrealized_pl_pct: number | null;
  weight: number | null;
}

export interface WatchlistSummary {
  ticker: string;
  asset_type: AssetType;
  note: string | null;
  target_weight: number | null; // fraction 0..1
  current_price: number | null;
}

export interface PortfolioSummary {
  holdings: HoldingSummary[];
  watchlist: WatchlistSummary[];
  total_market_value: number;
  total_cost_basis: number;
  total_pl: number;
  total_pl_pct: number | null;
  unpriced_count: number;
}

export interface Snapshot {
  id: number;
  created_at: string; // naive UTC, e.g. "2026-09-30T08:00:00"
  total_market_value: number;
  total_cost_basis: number;
}
