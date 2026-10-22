// No currency symbol, by design: totals add amounts as entered across currencies (spec).
const AMOUNT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Rounds to the displayed precision first, so a tiny negative never shows as "-0.00" or "-0.0%".
// Adding 0 turns a negative zero into a plain zero.
function round(value: number, digits: number): number {
  return Number(value.toFixed(digits)) + 0;
}

export function formatAmount(value: number): string {
  return AMOUNT.format(round(value, 2));
}

/** Today's UTC date as YYYY-MM-DD — the format date inputs and the API use. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today in the viewer's own time zone as YYYY-MM-DD: the calendar day a person means by "today". */
export function localTodayIso(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export function formatSigned(value: number): string {
  return `${round(value, 2) >= 0 ? "+" : ""}${formatAmount(value)}`;
}

/** Shown where there is no number to show (a missing or non-finite value). */
export const DASH = "—";

/**
 * A share of a whole as text: a fraction (0 to 1) as a percent, no sign ("31.2%"). Use it for weights,
 * allocations, volatility and falls. A missing or non-finite value gives DASH. Rounds to the shown
 * precision first, so a tiny negative never reads "-0.0%". The rounding is `toFixed` of the value
 * times 100, the same rule `formatPct` uses, so the two cannot disagree. For a signed move in
 * percentage points (a price change) use `formatPct`.
 */
export function formatShare(fraction: number | null | undefined, digits = 1): string {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return DASH;
  return `${round(fraction * 100, digits).toFixed(digits)}%`;
}

/** A signed move in percentage points ("+5.7%"): a price change. For a share of a whole use `formatShare`. */
export function formatPct(value: number): string {
  const rounded = round(value, 1);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

// The API returns naive UTC timestamps; Date.parse would otherwise read them as local time.
export function toTime(iso: string): number {
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`);
}

/** Plain decimal text (a comma works too) within min..max and at most `places` decimals; else null. */
export function parseDecimal(raw: string, places: number, min: number, max: number): number | null {
  const text = raw.trim().replace(",", "."); // some decimal keypads show a comma
  if (!new RegExp(String.raw`^\d+(\.\d{1,${places}})?$`).test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}
