import { apiFetch } from "@/lib/api/client";
import type { AssetType } from "@/lib/api/portfolio-types";
import type { Plan, PlanLine } from "@/lib/plans";

// Plain toFixed, not formatAmount: the text is pasted into a broker, so no thousands separators.
const eur = (value: number) => `${value.toFixed(2)} EUR`;
const trim = (value: number) => String(Number(value.toFixed(3)));

/** "Order (amount): 92.30 EUR · Name · ISIN X · about 1.69 shares at 54.64 EUR". */
export function ticketText(line: PlanLine, wholeShares: boolean): string {
  const shares = wholeShares
    ? `${trim(line.shares)} ${line.shares === 1 ? "share" : "shares"}`
    : `about ${trim(line.shares)} shares`;
  const parts = [`Order (amount): ${eur(line.amount_eur)}`, line.name];
  if (line.isin) parts.push(`ISIN ${line.isin}`);
  parts.push(`${shares} at ${eur(line.price_eur)}`);
  return parts.join(" · ");
}

export function unplacedLines(plan: Plan): PlanLine[] {
  return plan.lines.filter((l) => l.placed_at === null);
}

/** One ticket per line still to place; "" when every line is placed. */
export function copyAllText(plan: Plan): string {
  return unplacedLines(plan)
    .map((l) => ticketText(l, plan.whole_shares))
    .join("\n");
}

export interface PlaceBody {
  date: string; // YYYY-MM-DD
  shares: number;
  price: number;
  asset_type?: AssetType; // needed only when the ticker is not a holding yet
}

/** Records that the order was placed (logs the buy). Throws the ApiError. */
export function placeLine(planId: number, lineId: number, body: PlaceBody): Promise<PlanLine> {
  return apiFetch<PlanLine>(`/plans/${planId}/lines/${lineId}/placed`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** An empty string clears the ISIN. Throws the ApiError (422 for a malformed ISIN). */
export function setIsin(ticker: string, isin: string | null): Promise<{ ticker: string; isin: string | null }> {
  return apiFetch(`/portfolio/instruments/${encodeURIComponent(ticker)}/isin`, {
    method: "PUT",
    body: JSON.stringify({ isin }),
  });
}
