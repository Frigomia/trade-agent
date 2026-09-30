import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { PortfolioTile } from "./PortfolioTile";

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PortfolioTile />
    </SWRConfig>,
  );
}

const SUMMARY: PortfolioSummary = {
  holdings: [
    {
      ticker: "AAPL",
      name: "Apple",
      asset_type: "STOCK",
      shares: 10,
      cost_basis: 150,
      first_purchase_date: "2024-01-01",
      sector: null,
      target_weight: null,
      current_price: 200,
      market_value: 2000,
      unrealized_pl: 500,
      unrealized_pl_pct: 33,
      weight: 1,
    },
  ],
  watchlist: [],
  total_market_value: 2000,
  total_cost_basis: 1500,
  total_pl: 500,
  total_pl_pct: 33.3,
  unpriced_count: 0,
};

const TWO_SNAPSHOTS: Snapshot[] = [
  { id: 1, created_at: "2026-09-28T09:00:00", total_market_value: 1900, total_cost_basis: 1500 },
  { id: 2, created_at: "2026-09-29T09:00:00", total_market_value: 2000, total_cost_basis: 1500 },
];

function serve(summary: unknown, snapshots: Snapshot[] = []) {
  apiFetch.mockImplementation((path: string) => {
    if (path === "/portfolio/summary") return summary instanceof Error ? Promise.reject(summary) : Promise.resolve(summary);
    if (path === "/portfolio/snapshots") return Promise.resolve(snapshots);
    return Promise.reject(new Error("unexpected " + path));
  });
}

describe("PortfolioTile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the value, the P/L percentage and a sparkline", async () => {
    serve(SUMMARY, TWO_SNAPSHOTS);
    const { container } = renderFresh();

    await waitFor(() => expect(screen.getByText("Portfolio")).toBeInTheDocument());
    expect(screen.getByText("Portfolio").parentElement).toHaveTextContent("2,000.00");
    expect(screen.getByText("+33.3%")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector("polyline")).not.toBeNull());
  });

  it("draws no sparkline before there is any history", async () => {
    serve(SUMMARY, []);
    const { container } = renderFresh();

    await waitFor(() => expect(screen.getByText("+33.3%")).toBeInTheDocument());
    expect(container.querySelector("svg")).toBeNull();
  });

  it("invites the user to add holdings when there are none", async () => {
    serve({ ...SUMMARY, holdings: [] });
    renderFresh();

    const link = await screen.findByRole("link", { name: /portfolio/i });
    expect(link).toHaveAttribute("href", "/portfolio");
    expect(screen.getByText(/add your holdings in/i)).toBeInTheDocument();
  });

  it("says when a holding isn't priced", async () => {
    serve({ ...SUMMARY, unpriced_count: 2 });
    renderFresh();

    await waitFor(() => expect(screen.getByText(/2 not priced/i)).toBeInTheDocument());
  });

  it("renders nothing, quietly, when the summary can't be loaded", async () => {
    serve(new Error("boom"));
    const { container } = renderFresh();

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
