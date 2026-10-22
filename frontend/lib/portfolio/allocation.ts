import type { HoldingSummary } from "@/lib/api/portfolio-types";

export type AllocationDim = "sector" | "country" | "currency";

export const ALLOCATION_DIMS: { key: AllocationDim; label: string }[] = [
  { key: "sector", label: "Sector" },
  { key: "country", label: "Country" },
  { key: "currency", label: "Currency" },
];

/** Slices the donut can colour apart: the largest five groups, and everything smaller as "Other". */
export const MAX_GROUPS = 6;
export const OTHER = "Other";
/** The folded group's id: apart from any real group that is literally named "Other". */
export const OTHER_ID = "\u0000other";
export const UNKNOWN = "Unknown";

export interface AllocationGroup {
  /** What selects the group: its name, except for the folded "Other", which has its own id. */
  id: string;
  name: string;
  value: number;
  /** Share of the priced holdings, 0 to 1. */
  share: number;
  /** Every open holding in the group, priced or not, so filtering by it never hides one. */
  tickers: string[];
}

export interface Allocation {
  groups: AllocationGroup[];
  /** Sum of the priced open holdings, in the amounts as entered (nothing is converted). */
  total: number;
  /** Open holdings left out because they have no live price. */
  unpriced: number;
}

const priced = (h: HoldingSummary) => h.shares > 0 && h.market_value !== null && Number.isFinite(h.market_value) && h.market_value > 0;

/**
 * Where the money is, by sector, country or currency. Only open, priced holdings count, so the
 * shares add up to 1 and match the weights in the holdings table. A holding with no value for the
 * dimension is "Unknown", never dropped; groups past the sixth are folded into "Other".
 */
export function allocate(holdings: HoldingSummary[], dim: AllocationDim): Allocation {
  const open = holdings.filter((h) => h.shares > 0);
  const counted = open.filter(priced);
  const nameOf = (h: HoldingSummary) => (h[dim] ?? "").trim() || UNKNOWN;
  const byName = new Map<string, AllocationGroup>();
  for (const h of counted) {
    const name = nameOf(h);
    const group = byName.get(name) ?? { id: name, name, value: 0, share: 0, tickers: [] };
    group.value += h.market_value as number;
    group.tickers.push(h.ticker);
    byName.set(name, group);
  }
  // An unpriced holding has no value to add, but it belongs to the group it would be in.
  for (const h of open.filter((x) => !priced(x))) byName.get(nameOf(h))?.tickers.push(h.ticker);
  const total = counted.reduce((sum, h) => sum + (h.market_value as number), 0);
  let groups = [...byName.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  if (groups.length > MAX_GROUPS) {
    const rest = groups.slice(MAX_GROUPS - 1);
    groups = [
      ...groups.slice(0, MAX_GROUPS - 1),
      { id: OTHER_ID, name: OTHER, value: rest.reduce((s, g) => s + g.value, 0), share: 0, tickers: rest.flatMap((g) => g.tickers) },
    ];
  }
  for (const g of groups) g.share = total > 0 ? g.value / total : 0;
  return { groups, total, unpriced: open.length - counted.length };
}

export interface Position {
  ticker: string;
  name: string;
  value: number;
  share: number;
}

/** The biggest open, priced holdings by value, each with its share of the priced total. */
export function largestPositions(holdings: HoldingSummary[], count = 5): Position[] {
  const counted = holdings.filter(priced);
  const total = counted.reduce((sum, h) => sum + (h.market_value as number), 0);
  return counted
    .map((h) => ({ ticker: h.ticker, name: h.name, value: h.market_value as number, share: total > 0 ? (h.market_value as number) / total : 0 }))
    .sort((a, b) => b.value - a.value || a.ticker.localeCompare(b.ticker))
    .slice(0, count);
}
