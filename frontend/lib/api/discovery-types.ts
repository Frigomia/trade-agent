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

export interface Claim {
  text: string; // untrusted web text: render as plain text only
  kind: "fact" | "opinion" | "forecast" | "forum";
  stance: "bull" | "bear" | "neutral";
  materiality: "high" | "medium" | "low";
  source_tier: "official" | "reliable_reporting" | "other" | "forum";
  url: string;
  published_at: string | null;
  status?: "confirmed" | "disputed" | "unverified"; // absent on older reports: unverified
}

export interface Catalyst {
  text: string;
  occurs_on: string | null;
  event_id: string | null;
  evidence: string[];
}

export interface NegativeDevelopment {
  summary: string;
  occurred_on: string | null;
  evidence: string[]; // claim urls
  thesis_impact: string;
  status: "confirmed" | "disputed" | "unverified";
  invalidates_thesis: boolean;
}

/** How one metric of the company compares with its peers (backend PeerComparison). */
export interface PeerComparison {
  metric: string;
  value: number | null;
  peer_group: "industry" | "sector" | "none";
  peer_count: number;
  peer_median: number | null;
  peer_p25: number | null;
  peer_p75: number | null;
  position: "below" | "within" | "above" | "unavailable";
}

/** A named peer saved with the idea at scan time. Planned backend field: absent until it ships. */
export interface PeerRow {
  ticker: string;
  name: string;
  country: string | null;
  currency: string | null;
  market_cap_eur: number | null;
  values: Record<string, number | null>; // keyed by the same metric names as PeerComparison.metric
}

export interface IdeaSnapshot {
  exchange: string | null;
  country: string | null; // listing country, not revenue exposure
  sector: string | null;
  industry: string | null;
  currency: string | null; // major unit (GBP, not GBp)
  price: number | null; // the quote at scan time, not live
  price_as_of: string | null;
  fundamentals?: Record<string, number | null>; // raw provider metrics, saved with the scan
  coverage?: { core_metrics_present: number; core_metrics_total: number; missing: string[] };
  peers?: PeerRow[] | null; // named peers; planned backend field
}

/** What adding the company would do to the portfolio (backend CandidateFit). Saved only when it applied. */
export interface CandidateFit {
  ticker: string;
  applicable: boolean;
  avg_correlation_to_portfolio: number | null;
  portfolio_vol_before: number | null;
  portfolio_vol_after: number | null; // with the company at hypothetical_weight
  hhi_before: number | null; // concentration: 1 is everything in one holding
  hhi_after: number | null;
  sector_weight_before: number | null; // fractions 0..1
  sector_weight_after: number | null;
  hypothetical_weight: number;
  notes: string[];
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
  catalysts: (Catalyst | string)[]; // legacy text remains readable without an invented date
  outlook: string;
  bear_case: string;
  negative_developments: NegativeDevelopment[];
  peers?: PeerComparison[]; // absent on payloads from before the contract carried them
  competitors?: string[]; // companies the research names; planned backend field
  fit?: CandidateFit | null; // absent on ideas saved before the field; null when fit did not apply
  fit_summary: string | null;
  community_note: string | null;
  conclusion: string;
  sources: Claim[];
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

export type HistoryRange = "1w" | "1m" | "6m" | "1y" | "5y";

/** GET /discovery/ideas/{id}/history: dated daily closes in the major currency unit, oldest first. */
export interface PriceHistory {
  ticker: string;
  currency: string | null;
  as_of: string | null;
  range: HistoryRange;
  points: { date: string; close: number }[];
}
