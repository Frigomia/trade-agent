import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { alertRows } from "@/lib/alerts";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
import { TodayDesktop } from "./TodayDesktop";

beforeEach(() => vi.clearAllMocks());

describe("TodayDesktop", () => {
  it("shows the Portfolio alerts panel and no portfolio value chart, and asks for no snapshots", () => {
    const recs = [{ id: 1, ticker: "AAPL", action: "TRIM", status: "PENDING" }] as RecommendationOut[];
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><TodayDesktop rows={alertRows(undefined, recs)} /></SWRConfig>);

    expect(screen.getByRole("heading", { name: "Portfolio alerts" })).toBeInTheDocument();
    expect(screen.queryByText("Portfolio value")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/portfolio/snapshots");
  });

  const WATCH = { insights: [{ ticker: "NVDA", kind: "in_target_range" as const, text: "Entered your target price range", current_price: 98.4, target_price_low: 90, target_price_high: 110 }], missing: [] };
  const recs = [{ id: 1, ticker: "AAPL", action: "TRIM", status: "PENDING" }] as RecommendationOut[];
  const wrap = (ui: React.ReactElement) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

  it("puts the alerts and the watchlist insights side by side", () => {
    wrap(<TodayDesktop rows={alertRows(undefined, recs)} insights={WATCH} />);

    expect(screen.getByRole("region", { name: "Portfolio alerts" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Watchlist insights" })).toBeInTheDocument();
  });

  it("shows the watchlist insights alone when there are no alert rows, and the alerts alone when there are no insights", () => {
    const { unmount } = wrap(<TodayDesktop rows={[]} insights={WATCH} />);
    expect(screen.queryByRole("region", { name: "Portfolio alerts" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Watchlist insights" })).toBeInTheDocument();
    unmount();

    wrap(<TodayDesktop rows={alertRows(undefined, recs)} insights={{ insights: [], missing: [] }} />);
    expect(screen.queryByRole("region", { name: "Watchlist insights" })).not.toBeInTheDocument();
  });
});
