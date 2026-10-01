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

export function formatSigned(value: number): string {
  const rounded = round(value, 2);
  return `${rounded >= 0 ? "+" : ""}${formatAmount(rounded)}`;
}

export function formatPct(value: number): string {
  const rounded = round(value, 1);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}
