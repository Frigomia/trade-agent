import type { AssetType } from "@/lib/api/portfolio-types";

/** One stock or ETF listing, as `GET /market/search` returns it. `exchange` is "" when unknown. */
export interface SymbolMatch {
  symbol: string;
  name: string;
  type: AssetType;
  exchange: string;
  /** Set client-side only, when the picked result came from searching for an ISIN; the backend never sends it. */
  isin?: string;
}

/** Whether the text has the shape of an ISIN (the server also checks the ISO 6166 check digit). */
export function looksLikeIsin(text: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(text.trim().toUpperCase());
}
