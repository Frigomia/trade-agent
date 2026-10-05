import type { AssetType } from "@/lib/api/portfolio-types";

/** One stock or ETF listing, as `GET /market/search` returns it. `exchange` is "" when unknown. */
export interface SymbolMatch {
  symbol: string;
  name: string;
  type: AssetType;
  exchange: string;
}

export const MIN_SEARCH_LENGTH = 2;
