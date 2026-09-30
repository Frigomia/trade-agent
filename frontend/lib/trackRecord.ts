import type { Action, RecommendationOut } from "@/lib/api/recommendation-types";

export type Verdict = "matched" | "missed" | "unscored";

export interface TrackRow {
  rec: RecommendationOut;
  verdict: Verdict;
  movePct: number | null; // percent: 5.25 means +5.25%
}

export interface TrackSummary {
  rows: TrackRow[];
  matched: number;
  scored: number;
}

const UP_ACTIONS: Action[] = ["BUY", "ADD"];
const DOWN_ACTIONS: Action[] = ["TRIM", "SELL"];

function verdictFor(action: Action, movePct: number | null): Verdict {
  if (movePct === null) return "unscored";
  if (UP_ACTIONS.includes(action)) return movePct > 0 ? "matched" : "missed";
  if (DOWN_ACTIONS.includes(action)) return movePct < 0 ? "matched" : "missed";
  return "unscored"; // HOLD and WATCH make no directional call
}

/**
 * The Track record scoring rule (UI side, from the stored 20-day return). Superseded rows were
 * replaced by a newer run rather than decided, so they are left out; dismissed calls are scored
 * like approved ones. If the backend later stores a matched flag, use it instead.
 */
export function buildTrackRecord(recs: RecommendationOut[]): TrackSummary {
  const rows = recs
    .filter((rec) => rec.status !== "SUPERSEDED" && rec.outcome_evaluated_at != null)
    .map((rec): TrackRow => {
      const fraction = rec.outcome_forward_return_pct;
      const movePct = fraction == null ? null : fraction * 100;
      return { rec, verdict: verdictFor(rec.action, movePct), movePct };
    })
    .sort((a, b) => b.rec.created_at.localeCompare(a.rec.created_at));
  const scoredRows = rows.filter((row) => row.verdict !== "unscored");
  return {
    rows,
    matched: scoredRows.filter((row) => row.verdict === "matched").length,
    scored: scoredRows.length,
  };
}
