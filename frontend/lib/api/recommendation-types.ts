export type Action = "BUY" | "ADD" | "HOLD" | "TRIM" | "SELL" | "WATCH";
export type TechnicalSignal = "NEUTRAL" | "OVERSOLD" | "STRONG_UPTREND" | "WEAK_DOWNTREND";
export type RecommendationStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";

export interface RecommendationOut {
  id: number;
  user_id: string;
  created_at: string;
  ticker: string;
  asset_type: "ETF" | "STOCK";
  action: Action;
  reasoning: string[];
  ai_analysis: string | null;
  suggested_position_pct: number | null;
  status: RecommendationStatus;
  reviewed_at: string | null;
  fundamental_score: number | null;
  technical_signal: TechnicalSignal | null;
  price_at_recommendation: number | null;
  current_price: number | null;
  price_change_pct: number | null;
}

export interface JobResult {
  ticker: string;
  recommendation_id?: number;
  skipped?: boolean;
  error?: string;
}

export interface JobStatus {
  status: "RUNNING" | "DONE" | "FAILED";
  total: number;
  done: number;
  results: JobResult[];
}
