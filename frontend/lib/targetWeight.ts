export const TARGET_ERROR = "Enter a target from 0 to 100, two decimals at most.";

/** A saved fraction (0..1) as the text of the percent field; "" when there is none. */
export function fractionToPercentText(fraction: number | null | undefined): string {
  return fraction == null ? "" : String(Math.round(fraction * 10000) / 100);
}

/** The percent field's text as a fraction: null when blank, undefined when invalid. */
export function percentTextToFraction(raw: string): number | null | undefined {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const percent = Number(text);
  return percent <= 100 ? Math.round(percent * 100) / 10000 : undefined;
}

/**
 * The target the plan uses for a holding, as the backend decides it: its own target above 0, else the
 * watchlist target above 0 for the same ticker, else none.
 */
export function effectiveTarget(
  holding: { ticker: string; target_weight: number | null },
  watchlist: { ticker: string; target_weight: number | null }[],
): { target: number; fromWatchlist: boolean } | null {
  if ((holding.target_weight ?? 0) > 0) return { target: holding.target_weight!, fromWatchlist: false };
  const ticker = holding.ticker.toUpperCase();
  const watched = watchlist.find((w) => w.ticker.toUpperCase() === ticker)?.target_weight ?? 0;
  return watched > 0 ? { target: watched, fromWatchlist: true } : null;
}
