import type { AlertKind, PortfolioAlerts } from "@/lib/api/alert-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

/** One line of the Portfolio alerts panel, whether it came from the alerts endpoint or from a call. */
export interface AlertRow {
  key: string;
  ticker: string;
  name: string | null;
  kind: AlertKind;
  text: string;
  /** Where the row opens: a call's analysis, or the Portfolio page for earnings and moves. */
  href: string;
  direction: "up" | "down" | null;
  source: RecommendationOut["source"];
}

const callRow = (rec: RecommendationOut): AlertRow => ({
  key: `rec-${rec.id}`,
  ticker: rec.ticker,
  name: rec.name ?? null,
  kind: "new_recommendation",
  text: `New AI recommendation: ${rec.action}`,
  href: `/today/${rec.id}`,
  direction: null,
  source: rec.source,
});

/**
 * The rows to show. With the typed alerts loaded they are the rows; until then (loading, or the
 * endpoint not deployed yet) the pending calls stand in as "new insight" rows. A pending call the
 * typed alerts do not list (made since they were fetched) is added in front, so the panel never
 * goes blank and a decision waiting is never hidden.
 */
export function alertRows(typed: PortfolioAlerts | undefined, calls: RecommendationOut[]): AlertRow[] {
  if (!typed) return calls.map(callRow);
  const byId = new Map(calls.map((c) => [c.id, c]));
  const listed = new Set(typed.alerts.map((a) => a.recommendation_id));
  const unlisted = calls.filter((c) => !listed.has(c.id)).map(callRow);
  const rows = typed.alerts.map((a, i): AlertRow => ({
    key: `${a.kind}-${a.ticker}-${i}`,
    ticker: a.ticker,
    name: a.name,
    kind: a.kind,
    text: a.text,
    href: a.recommendation_id !== null ? `/today/${a.recommendation_id}` : "/portfolio",
    direction: a.direction,
    source: a.recommendation_id !== null ? byId.get(a.recommendation_id)?.source : undefined,
  }));
  return [...unlisted, ...rows];
}

export type PillTone = "outline" | "muted" | "up" | "down";

/** The pill for a row: its kind in words, with a tone that is colour only for a price move. */
export function alertPill(row: Pick<AlertRow, "kind" | "direction">): { label: string; tone: PillTone } {
  if (row.kind === "new_recommendation") return { label: "New insight", tone: "outline" };
  if (row.kind === "earnings_upcoming") return { label: "Up next", tone: "muted" };
  if (row.direction === "up") return { label: "Positive move", tone: "up" };
  if (row.direction === "down") return { label: "Negative move", tone: "down" };
  return { label: "Moved", tone: "outline" };
}

/** A sentence for what could not be checked, or null when everything was. */
export function missingNote(missing: PortfolioAlerts["missing"]): string | null {
  const parts = [missing.includes("earnings") && "earnings dates", missing.includes("prices") && "some prices"].filter(Boolean);
  return parts.length > 0 ? `Could not check ${parts.join(" or ")}, so alerts of that kind may be missing.` : null;
}
