import { useMemo } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import type { SymbolMatch } from "@/lib/tickerSearch";

/**
 * The tickers the user already cares about, in the shape the ticker picker offers first: open
 * holdings, then watched tickers they don't hold. Shares the Portfolio screen's request, so it
 * costs nothing extra; empty while loading or if that request fails.
 */
export function usePortfolioSuggestions(): SymbolMatch[] {
  const { data } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  return useMemo(() => {
    if (!data) return [];
    const held = data.holdings
      .filter((h) => h.shares > 0)
      .map((h) => ({ symbol: h.ticker, name: h.name, type: h.asset_type, exchange: "" }));
    const heldSymbols = new Set(held.map((h) => h.symbol));
    const watched = data.watchlist
      .filter((w) => !heldSymbols.has(w.ticker))
      .map((w) => ({ symbol: w.ticker, name: "On your watchlist", type: w.asset_type, exchange: "" }));
    return [...held, ...watched];
  }, [data]);
}
