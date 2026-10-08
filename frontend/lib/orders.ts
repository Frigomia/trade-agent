import { apiFetch } from "@/lib/api/client";
import type { AssetType } from "@/lib/api/portfolio-types";
import { parseDecimal } from "@/lib/format";
import type { Plan, PlanLine } from "@/lib/plans";

// Plain toFixed, not formatAmount: the text is pasted into a broker, so no thousands separators.
const eur = (value: number) => `${value.toFixed(2)} EUR`;
/** Shares to at most 3 decimals, trailing zeros dropped: 1.69, 2.772, 3. */
export const trim = (value: number) => String(Number(value.toFixed(3)));

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

/** "1.69 sh at 54.60" from the logged trade (holding currency, no separators); null when not known. */
export function placedFill(line: PlanLine): string | null {
  if (line.placed_shares === null || line.placed_price === null) return null;
  return `${trim(line.placed_shares)} sh at ${line.placed_price.toFixed(2)}`;
}

/**
 * The line to open after `ticker` was recorded as placed: the next unplaced one after it in the
 * plan's order, else the first unplaced one before it; null when it was the last.
 */
export function nextUnplaced(plan: Plan, ticker: string): PlanLine | null {
  const at = plan.lines.findIndex((l) => l.ticker === ticker);
  const rest = [...plan.lines.slice(at + 1), ...plan.lines.slice(0, Math.max(at, 0))];
  return rest.find((l) => l.placed_at === null && l.ticker !== ticker) ?? null;
}

/**
 * Shares or price as typed: plain decimal text (a comma works), above zero, within what the
 * backend's Numeric(18, 6) columns hold. null for "", "1e5", "-1", "0", "abc" and the like.
 */
export function parsePlacedNumber(raw: string): number | null {
  return parseDecimal(raw, 6, 0.000001, 999_999_999_999);
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

/** The ISIN, trimmed and upper-cased, when its shape fits (the server also checks the check digit); else null. */
export function isinShape(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value) ? value : null;
}

/** An empty string clears the ISIN. Throws the ApiError (422 for a malformed ISIN). */
export function setIsin(ticker: string, isin: string | null): Promise<{ ticker: string; isin: string | null }> {
  return apiFetch(`/portfolio/instruments/${encodeURIComponent(ticker)}/isin`, {
    method: "PUT",
    body: JSON.stringify({ isin }),
  });
}
