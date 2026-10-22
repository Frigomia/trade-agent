import { parseDecimal } from "@/lib/format";

export const RANGE_ERROR = "Enter both ends of the range, lowest first, or leave both blank.";

// The column holds six decimals and less than 10^12 (backend WatchlistItem.target_price_*).
const parsePrice = (raw: string) => parseDecimal(raw, 6, 0.000001, 999_999_999_999);

/** A saved price as the text of its field; "" when there is none. */
export function priceToText(price: number | null | undefined): string {
  return price == null ? "" : String(price);
}

/** A price as it is read on screen: its own decimals up to the six stored, never rounded to two. */
export const priceText = (price: number) => price.toLocaleString("en-US", { maximumFractionDigits: 6 });

export interface PriceRange {
  low: number;
  high: number;
}

/**
 * The two fields as a range: null when both are blank (no range), undefined when they are not a
 * valid one (one blank, not a price, or lowest above highest).
 */
export function textsToRange(lowText: string, highText: string): PriceRange | null | undefined {
  const blank = [lowText, highText].map((t) => t.trim() === "");
  if (blank[0] && blank[1]) return null;
  if (blank[0] || blank[1]) return undefined;
  const low = parsePrice(lowText);
  const high = parsePrice(highText);
  return low === null || high === null || low > high ? undefined : { low, high };
}
