import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { usePortfolioSuggestions } from "./usePortfolioSuggestions";

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

describe("usePortfolioSuggestions", () => {
  it("lists open holdings, then watched tickers not already held", async () => {
    apiFetch.mockResolvedValue({
      holdings: [
        { ticker: "VWCE.DE", name: "Vanguard FTSE All-World", asset_type: "ETF", shares: 4 },
        { ticker: "OLD", name: "Sold out", asset_type: "STOCK", shares: 0 },
      ],
      watchlist: [
        { ticker: "AAPL", asset_type: "STOCK", note: null },
        { ticker: "VWCE.DE", asset_type: "ETF", note: "dup" },
      ],
    });

    const { result } = renderHook(() => usePortfolioSuggestions(), { wrapper });

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current).toEqual([
      { symbol: "VWCE.DE", name: "Vanguard FTSE All-World", type: "ETF", exchange: "" },
      { symbol: "AAPL", name: "On your watchlist", type: "STOCK", exchange: "" },
    ]);
  });

  it("is empty when the portfolio cannot be loaded", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => usePortfolioSuggestions(), { wrapper });

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
