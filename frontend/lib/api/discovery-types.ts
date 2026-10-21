import type { RecommendationOut } from "./recommendation-types";

// Mirrors backend/app/schemas_discovery.py (IdeaOut and what it holds) and ScanRunOut in schemas.py.
export type Level = "high" | "medium" | "low";
export type RiskLevel = "low" | "medium" | "high" | "unknown";

export interface DimensionScore {
  name: "quality" | "valuation" | "fit";
  score: number | null; // null: unavailable, never a default
  reasons: string[];
}

export interface RiskProfile {
  market_cap_eur: number | null;
  avg_daily_value_eur: number | null;
  size_bucket: string;
  volatility_annualized: number | null;
  max_drawdown_1y: number | null;
  risk_flags: string[];
  risk_level: RiskLevel;
}

export interface IdeaSnapshot {
  exchange: string | null;
  country: string | null; // listing country, not revenue exposure
  sector: string | null;
  industry: string | null;
  currency: string | null; // major unit (GBP, not GBp)
  price: number | null; // the quote at scan time, not live
  price_as_of: string | null;
}

export interface IdeaOut {
  ticker: string;
  name: string;
  asset_type: string;
  scores: DimensionScore[];
  overall: number | null;
  confidence: Level;
  risk: RiskProfile;
  thesis: string;
  catalysts: string[];
  outlook: string;
  bear_case: string;
  conclusion: string;
  sources: { url: string }[];
  data_notes: string[];
  // Absent on ideas saved before the display fields existed.
  snapshot?: IdeaSnapshot | null;
  headline?: string | null;
}

export interface DiscoveryRecommendation extends Omit<RecommendationOut, "idea"> {
  idea: IdeaOut | null;
}

export interface NearestMiss {
  ticker: string;
  name?: string; // older scans stored the ticker only
  overall: number | null;
  confidence: Level;
}

export interface ScanRun {
  id: number;
  created_at: string;
  status: string;
  universe_size: number;
  eligible: number;
  shortlisted: number;
  researched: number;
  outcome: "ideas" | "none";
  summary: string;
  coverage_summary: { nearest_misses?: NearestMiss[] } & Record<string, unknown>;
  opportunities: number | null; // null on scans saved before the count was stored
  set_aside: number | null;
}

export interface DiscoveryIdeas {
  recommendations: DiscoveryRecommendation[];
  latest_scan: ScanRun | null;
}

export interface DiscoveryJob {
  status: "RUNNING" | "DONE" | "FAILED";
  stage: string;
  total: number;
  done: number;
  error: string | null;
}
