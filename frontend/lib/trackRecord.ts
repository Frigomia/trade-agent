import type { Action, RecommendationOut } from "@/lib/api/recommendation-types";

export type Verdict = "matched" | "missed" | "unscored";

/** Where a call came from: the holdings analysis (manual or scheduled) or a market-scan idea. */
export type Kind = "holdings" | "discovery";

export interface TrackRow {
  rec: RecommendationOut;
  kind: Kind;
  /** YYYY-MM-DD of the close the return is measured from: the saved snapshot's close for a discovery
   *  idea (it can be days before the call), the day of the call otherwise. */
  entryDay: string;
  verdict: Verdict;
  movePct: number | null; // percent: 5.25 means +5.25%
}

export interface SourceSummary {
  count: number; // calls of this kind that have been evaluated
  matched: number;
  scored: number;
}

export interface TrackSummary {
  rows: TrackRow[];
  scored: number;
  bySource: Record<Kind, SourceSummary>;
}

const kindOf = (rec: RecommendationOut): Kind => (rec.source === "discovery" ? "discovery" : "holdings");

const UP_ACTIONS: Action[] = ["BUY", "ADD"];
const DOWN_ACTIONS: Action[] = ["TRIM", "SELL"];

function verdictFor(action: Action, movePct: number | null): Verdict {
  if (movePct === null) return "unscored";
  if (UP_ACTIONS.includes(action)) return movePct > 0 ? "matched" : "missed";
  if (DOWN_ACTIONS.includes(action)) return movePct < 0 ? "matched" : "missed";
  return "unscored"; // HOLD and WATCH make no directional call
}

/**
 * The Track record scoring rule (UI side, from the stored 20-trading-day return). A holdings call
 * that a newer run replaced was never decided, so it is left out. A discovery idea that a later
 * scan replaced was still issued and measured, so it stays. Dismissed calls are scored like
 * approved ones. If the backend later stores a matched flag, use it instead.
 */
export function buildTrackRecord(recs: RecommendationOut[]): TrackSummary {
  const rows = recs
    .filter((rec) => rec.outcome_evaluated_at != null && (rec.status !== "SUPERSEDED" || kindOf(rec) === "discovery"))
    .map((rec): TrackRow => {
      const fraction = rec.outcome_forward_return_pct;
      const movePct = fraction == null ? null : fraction * 100;
      const entryDay = (rec.idea?.snapshot?.price_as_of ?? rec.created_at).slice(0, 10);
      return { rec, kind: kindOf(rec), entryDay, verdict: verdictFor(rec.action, movePct), movePct };
    })
    .sort((a, b) => b.rec.created_at.localeCompare(a.rec.created_at));
  const summarize = (kind: Kind): SourceSummary => {
    const own = rows.filter((row) => row.kind === kind);
    const scoredRows = own.filter((row) => row.verdict !== "unscored");
    return { count: own.length, matched: scoredRows.filter((row) => row.verdict === "matched").length, scored: scoredRows.length };
  };
  const bySource = { holdings: summarize("holdings"), discovery: summarize("discovery") };
  return { rows, scored: bySource.holdings.scored + bySource.discovery.scored, bySource };
}
