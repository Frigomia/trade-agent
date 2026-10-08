import { ApiError, apiFetch } from "@/lib/api/client";
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

/** A price to at most 4 decimals, trailing zeros dropped down to 2: 54.60, 0.004, 1.1234. */
export const fillPrice = (value: number) => value.toFixed(4).replace(/0{1,2}$/, "");

/** "1.69 sh at 54.60" from the logged trade (holding currency, no separators); null when not known. */
export function placedFill(line: PlanLine): string | null {
  if (line.placed_shares === null || line.placed_price === null) return null;
  return `${trim(line.placed_shares)} sh at ${fillPrice(line.placed_price)}`;
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

export const THOUSANDS_ERROR =
  "Use a decimal point and no thousands separators, for example 1000.50. For a price with three decimals, add a trailing 0: 54.6050.";
/** Per field, so the shares field never shows a price as its example. */
export const DIGITS_ERROR = { shares: "Use digits like 1.69", price: "Use digits like 54.60" } as const;

export interface PlacedNumber {
  value: number | null; // null while empty or invalid
  error: string | null; // null while empty or valid
}

/**
 * Shares or price as typed: digits with one decimal point or comma ("5,5" is 5.5), above zero, at
 * most 6 decimals, within what the backend's Numeric(18, 6) columns hold. Text that reads as a
 * thousands separator is refused rather than guessed, since a guess can be 1000 times off:
 * "1,000,000", "1,000.5" and, for a price, "1,000" / "1.000" (but not "0.125"). A share count
 * keeps a single 3-decimal group ("2.772"): fractional shares look like that, and so does the
 * prefilled plan amount; but not "1,000" / "1.000", a group of zeros the prefill never produces.
 */
export function readPlacedNumber(raw: string, kind: "shares" | "price"): PlacedNumber {
  const text = raw.trim();
  if (text === "") return { value: null, error: null };
  const fail = (error: string) => ({ value: null, error });
  const above = kind === "price" ? "Enter a price above 0." : "Enter a number of shares above 0.";
  if (/^\d+([.,]\d{3}){2,}$/.test(text) || (text.includes(",") && text.includes("."))) return fail(THOUSANDS_ERROR);
  const group = kind === "price" ? /^[1-9]\d{0,2}[.,]\d{3}$/ : /^[1-9]\d{0,2}[.,]000$/;
  if (group.test(text)) return fail(THOUSANDS_ERROR);
  if (/^-\d/.test(text)) return fail(above);
  if (!/^\d+([.,]\d+)?$/.test(text)) return fail(DIGITS_ERROR[kind]);
  if (/[.,]\d{7,}$/.test(text)) return fail("Use at most 6 decimals.");
  const value = parseDecimal(text, 6, 0.000001, 999_999_999_999);
  if (value !== null) return { value, error: null };
  return fail(Number(text.replace(",", ".")) > 0 ? "That number is too large." : above);
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

/**
 * Records that the order was placed (logs the buy). Throws the ApiError, or fetch's own error when
 * the server cannot be reached or does not answer within 30 seconds.
 */
export function placeLine(planId: number, lineId: number, body: PlaceBody): Promise<PlanLine> {
  return apiFetch<PlanLine>(`/plans/${planId}/lines/${lineId}/placed`, {
    method: "POST",
    body: JSON.stringify(body),
    // A hung request ends as an error, so the sheet shows its network message and can be closed.
    signal: AbortSignal.timeout(30_000),
  });
}

/** An empty string clears the ISIN. Throws the ApiError (422 for a malformed ISIN). */
export function setIsin(ticker: string, isin: string | null): Promise<{ ticker: string; isin: string | null }> {
  return apiFetch(`/portfolio/instruments/${encodeURIComponent(ticker)}/isin`, {
    method: "PUT",
    body: JSON.stringify({ isin }),
  });
}

/**
 * Saves an ISIN found by searching for it, after the holding or watchlist row it belongs to was
 * saved. Never throws: returns a note when it failed (the add itself still counts as saved), else
 * null. The ISIN is not logged.
 */
export async function saveIsinAfterAdd(ticker: string, isin: string | null): Promise<string | null> {
  if (!isin) return null;
  try {
    await setIsin(ticker, isin);
    return null;
  } catch (err) {
    const detail = err instanceof ApiError ? err.detail : "the request failed";
    return `Saved. The ISIN could not be saved: ${detail}. Add it on a plan.`;
  }
}
