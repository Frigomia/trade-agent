// Mirrors DiscoverItemOut and DiscoverOut in backend/app/routers/discover.py (GET /discover): the
// watchlist as a browsable list, with each company's cached quote and what a scan found about it.
export interface DiscoverItem {
  ticker: string;
  asset_type: "ETF" | "STOCK";
  name: string | null; // None until it was resolved: show the ticker
  exchange: string | null;
  currency: string | null; // the major unit (GBP, not GBp) the price is in; null when unknown
  source: "manual" | "today"; // added by the person, or saved from a Today idea
  added_at: string | null; // naive UTC; null for items added before Discover existed
  note: string | null;
  target_weight: number | null;
  target_price_low: number | null; // in the same unit as price
  target_price_high: number | null;
  price: number | null; // null when there is no usable quote
  change_pct: number | null; // last close against the one before, in percent
  price_as_of: string | null; // YYYY-MM-DD
  stale: boolean;
  status: "analyzed" | "none"; // analyzed: a scan saved an idea for it (never started from here)
  insight: string | null; // the idea's one-line reading, only when analyzed. Scan text: render as text.
  report_id: number | null; // the idea's id, to open its report at /today/{id}
}

export interface DiscoverList {
  items: DiscoverItem[];
  // What could not be looked up, so a missing price is not read as "no change".
  missing: "prices"[];
}
