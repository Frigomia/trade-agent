import type { DiscoverItem } from "@/lib/api/discover-types";
import { toTime } from "@/lib/format";
import { fractionToPercentText } from "@/lib/targetWeight";

export type DiscoverFilter = "all" | "analyzed" | "none";
export type DiscoverSort = "new" | "name" | "change";

export const FILTERS: { key: DiscoverFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "analyzed", label: "AI analyzed" },
  { key: "none", label: "Not analyzed" },
];

export const SORTS: { key: DiscoverSort; label: string }[] = [
  { key: "new", label: "Recently added" },
  { key: "name", label: "Name" },
  { key: "change", label: "Daily change" },
];

export const nameOf = (item: DiscoverItem) => item.name ?? item.ticker;
/** Researched by a scan and with a report to open: the one rule the filters, the counts and the card share. */
export const isAnalyzed = (item: DiscoverItem) => item.status === "analyzed" && item.report_id !== null;

/** How many companies each filter would show, so the buttons can say before they are pressed. */
export function counts(items: DiscoverItem[]): Record<DiscoverFilter, number> {
  const analyzed = items.filter(isAnalyzed).length;
  return { all: items.length, analyzed, none: items.length - analyzed };
}

/**
 * The list as shown: filtered, then sorted. Recently added puts the newest first and the items from
 * before Discover recorded a date last; Daily change puts the biggest rise first and a company with
 * no quote last, never in the middle as a zero.
 */
export function visibleItems(items: DiscoverItem[], filter: DiscoverFilter, sort: DiscoverSort): DiscoverItem[] {
  const shown = filter === "all" ? items : items.filter((i) => isAnalyzed(i) === (filter === "analyzed"));
  const byName = (a: DiscoverItem, b: DiscoverItem) => nameOf(a).localeCompare(nameOf(b)) || a.ticker.localeCompare(b.ticker);
  const compare: Record<DiscoverSort, (a: DiscoverItem, b: DiscoverItem) => number> = {
    new: (a, b) => {
      const [ta, tb] = [a.added_at ? toTime(a.added_at) : null, b.added_at ? toTime(b.added_at) : null];
      if (ta === null || tb === null) return ta === tb ? byName(a, b) : ta === null ? 1 : -1;
      return tb - ta || byName(a, b);
    },
    name: byName,
    change: (a, b) => {
      const [ca, cb] = [a.change_pct, b.change_pct];
      if (ca === null || cb === null) return ca === cb ? byName(a, b) : ca === null ? 1 : -1;
      return cb - ca || byName(a, b);
    },
  };
  return [...shown].sort(compare[sort]);
}

/** "Added 2 days ago · saved from Today". An item with no recorded date says "Added earlier". */
export function addedText(item: DiscoverItem, now: number): string {
  const days = item.added_at ? Math.max(0, Math.floor((now - toTime(item.added_at)) / 86_400_000)) : null;
  const when = days === null ? "earlier" : days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;
  return `Added ${when} · ${item.source === "today" ? "saved from Today" : "by you"}`;
}

/** "HLDN · NASDAQ · USD", leaving out what is not known. */
export function metaText(item: DiscoverItem): string {
  return [item.ticker, item.exchange, item.currency].filter(Boolean).join(" · ");
}

// A currency quoted in whole units has no cents on a stock price page (the yen).
const WHOLE_UNITS = new Set(["JPY", "KRW", "IDR", "VND", "CLP", "HUF"]);

/** A price as a number: two decimals (none for the yen), or up to `most` when it has more. */
function amountText(price: number, currency: string | null, most = 0): string {
  const digits = currency && WHOLE_UNITS.has(currency) ? 0 : 2;
  return price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, most) });
}

/** "USD 184.20" or "JPY 3,845"; just the number when the currency is not known (no unit is claimed). */
export function priceText(item: Pick<DiscoverItem, "price" | "currency">): string | null {
  if (item.price === null || !Number.isFinite(item.price)) return null;
  const number = amountText(item.price, item.currency);
  return item.currency ? `${item.currency} ${number}` : number;
}

/**
 * What the person set, in words: "Target 5% · Range USD 90.00 to 110.00". The weight is left out for an
 * owned company (its target lives on the holding). Null when nothing is set.
 */
export function targetsText(item: Pick<DiscoverItem, "owned" | "target_weight" | "target_price_low" | "target_price_high" | "currency">): string | null {
  const parts: string[] = [];
  if (!item.owned && item.target_weight !== null && item.target_weight > 0) parts.push(`Target ${fractionToPercentText(item.target_weight)}%`);
  const { target_price_low: low, target_price_high: high, currency } = item;
  if (low !== null && high !== null) parts.push(rangeText(low, high, currency));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Range USD 90.00 to 110.00": the unit once, then both ends with their own decimals. */
export function rangeText(low: number, high: number, currency: string | null): string {
  return `Range ${currency ? `${currency} ` : ""}${amountText(low, currency, 6)} to ${amountText(high, currency, 6)}`;
}
