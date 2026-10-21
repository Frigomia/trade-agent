import type { PeerComparison, RiskProfile } from "@/lib/api/discovery-types";

type Unit = "fraction" | "percent" | "multiple";

/**
 * The company metrics the discovery scan compares with peers (backend/app/discovery/peers.py),
 * with the label to show and how Yahoo reports each: a fraction (0.21 is 21%), a figure already in
 * percent (dividend yield, debt to equity) or a multiple (24.6 is 24.6x).
 */
const METRICS: Record<string, { label: string; unit: Unit }> = {
  returnOnEquity: { label: "Return on equity", unit: "fraction" },
  returnOnAssets: { label: "Return on assets", unit: "fraction" },
  operatingMargins: { label: "Operating margin", unit: "fraction" },
  revenueGrowth: { label: "Revenue growth", unit: "fraction" },
  fcfMargin: { label: "Free cash flow margin", unit: "fraction" },
  payoutRatio: { label: "Payout ratio", unit: "fraction" },
  debtToEquity: { label: "Debt to equity", unit: "percent" },
  dividendYield: { label: "Dividend yield", unit: "percent" },
  trailingPE: { label: "P/E", unit: "multiple" },
  enterpriseToEbitda: { label: "EV/EBITDA", unit: "multiple" },
  pegRatio: { label: "PEG ratio", unit: "multiple" },
  priceToSalesTrailing12Months: { label: "Price to sales", unit: "multiple" },
  priceToBook: { label: "Price to book", unit: "multiple" },
  interestCoverage: { label: "Interest cover", unit: "multiple" },
  priceToFfo: { label: "Price to FFO", unit: "multiple" },
};

/** A readable name for a metric key; an unknown key is shown as its own name rather than hidden. */
export function metricLabel(key: string): string {
  return METRICS[key]?.label ?? key;
}

// One decimal, but two below 1 so a small figure (a PEG of 0.04) does not read as zero.
const one = (n: number) => (n !== 0 && Math.abs(n) < 1 ? n.toFixed(2) : n.toFixed(1));

/** "21.3%" or "24.6x" from the raw figure, or null when it is missing or not a finite number. */
export function formatMetric(key: string, value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const unit = METRICS[key]?.unit;
  if (unit === "fraction") return `${one(value * 100)}%`;
  if (unit === "percent") return `${one(value)}%`;
  if (unit === "multiple") return `${one(value)}x`;
  return String(Number(value.toPrecision(3))); // an unlisted metric: the number, with no unit guessed
}

export type Position = PeerComparison["position"];

/** The words for where a value sits among its peers; neutral, because lower is not always better. */
export const POSITION_WORD: Record<Exclude<Position, "unavailable">, string> = {
  below: "Below peer median",
  within: "Within the usual range",
  above: "Above peer median",
};

export interface BandLayout {
  /** Percent along the track for the middle half of peers, their median and the company. */
  band: { left: number; width: number };
  median: number;
  value: number;
}

/**
 * Where the peer band, the median tick and the company's dot sit on a track, in percent. The track
 * runs a little beyond the widest of the company and the band so nothing touches the edge.
 * Null when any of the peer figures is missing, so the caller shows the raw value instead.
 */
export function bandLayout(c: PeerComparison): BandLayout | null {
  const { value, peer_median: med, peer_p25: p25, peer_p75: p75 } = c;
  if (value === null || med === null || p25 === null || p75 === null) return null;
  const spread = Math.max(p75 - p25, Math.abs(med) * 0.1, 1e-9);
  const lo = Math.min(value, p25) - spread * 0.35;
  const hi = Math.max(value, p75) + spread * 0.35;
  const at = (n: number) => ((n - lo) / (hi - lo)) * 100;
  return { band: { left: at(p25), width: at(p75) - at(p25) }, median: at(med), value: at(value) };
}

/** "Industry group · 12 companies", from the comparisons; null when no peer group was found. */
export function peerGroupLabel(peers: PeerComparison[]): string | null {
  const usable = peers.filter((p) => p.peer_group !== "none" && p.peer_count > 0);
  if (usable.length === 0) return null;
  const group = usable[0].peer_group === "industry" ? "Industry group" : "Sector group";
  return `${group} · ${Math.max(...usable.map((p) => p.peer_count))} companies`;
}

const SIZE_WORD: Record<RiskProfile["size_bucket"], string> = { micro: "Micro", small: "Small", mid: "Mid-sized", large: "Large", unknown: "Unknown" };
export const sizeWord = (bucket: RiskProfile["size_bucket"]) => SIZE_WORD[bucket] ?? "Unknown";

/** "EUR 38.2B" or "EUR 190M" from an amount in euros; null when unknown. */
export function eurCompact(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (value >= 1e9) return `EUR ${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `EUR ${(value / 1e6).toFixed(0)}M`;
  return `EUR ${Math.round(value / 1e3)}K`;
}

const FLAG_WORD: Record<string, string> = {
  small_cap: "Small company",
  thin_liquidity: "Thin trading",
  high_volatility: "High volatility",
  negative_equity: "Negative equity",
};

/** A backend risk flag ("thin_liquidity: 0.4M EUR traded a day") as a title and its detail. */
export function riskFlag(flag: string): { title: string; detail: string } {
  const at = flag.indexOf(": ");
  const code = at === -1 ? flag : flag.slice(0, at);
  return { title: FLAG_WORD[code] ?? code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), detail: at === -1 ? "" : flag.slice(at + 2) };
}
