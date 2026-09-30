// No currency symbol, by design: totals add amounts as entered across currencies (spec).
const AMOUNT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(value: number): string {
  return AMOUNT.format(value);
}

export function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatAmount(value)}`;
}

export function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
