import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));
// Tested on its own; here it would only add unrelated POSTs.
vi.mock("@/lib/portfolio/useDailySnapshot", () => ({ useDailySnapshot: () => {} }));

import PortfolioPage from "./page";

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PortfolioPage />
    </SWRConfig>,
  );
}

const HOLDING_BASE = {
  asset_type: "STOCK" as const,
  first_purchase_date: "2024-01-01",
  sector: null,
  target_weight: null,
};

const SUMMARY: PortfolioSummary = {
  holdings: [
    {
      ...HOLDING_BASE,
      ticker: "AAPL",
      name: "Apple Inc.",
      shares: 10,
      cost_basis: 150,
      current_price: 200,
      market_value: 2000,
      unrealized_pl: 500,
      unrealized_pl_pct: 33.3,
      weight: 0.513,
    },
    {
      ...HOLDING_BASE,
      ticker: "MSFT",
      name: "Microsoft",
      shares: 5,
      cost_basis: 400,
      current_price: 380,
      market_value: 1900,
      unrealized_pl: -100,
      unrealized_pl_pct: -5,
      weight: 0.487,
    },
    {
      ...HOLDING_BASE,
      ticker: "OLD",
      name: "Sold Out Co",
      shares: 0,
      cost_basis: 10,
      current_price: null,
      market_value: null,
      unrealized_pl: null,
      unrealized_pl_pct: null,
      weight: null,
    },
  ],
  watchlist: [{ ticker: "ASML", asset_type: "STOCK", note: null, current_price: 702.4 }],
  total_market_value: 3900,
  total_cost_basis: 3500,
  total_pl: 400,
  total_pl_pct: 11.4,
  unpriced_count: 0,
};

const SNAPSHOTS: Snapshot[] = [];

let handlers: Record<string, () => unknown>;

function count(key: string): number {
  return apiFetch.mock.calls.filter(
    (c) => `${(c[1] as RequestInit | undefined)?.method ?? "GET"} ${c[0]}` === key,
  ).length;
}

describe("PortfolioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {
      "GET /portfolio/summary": () => SUMMARY,
      "GET /portfolio/snapshots": () => SNAPSHOTS,
    };
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const handler = handlers[`${init?.method ?? "GET"} ${path}`];
      if (!handler) return Promise.reject(new Error("unexpected " + path));
      try {
        return Promise.resolve(handler());
      } catch (err) {
        return Promise.reject(err);
      }
    });
  });

  it("shows the totals, the mixed-currency note, and only open holdings", async () => {
    renderFresh();

    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
    expect(screen.getByText("Portfolio value").parentElement).toHaveTextContent("3,900.00");
    expect(screen.getByText("Cost basis").parentElement).toHaveTextContent("3,500.00");
    expect(screen.getByText("Total P/L").parentElement).toHaveTextContent("+400.00");
    expect(screen.getByText(/mixed currencies are not converted/i)).toBeInTheDocument();
    expect(screen.getByText("Microsoft")).toBeInTheDocument();
    expect(screen.queryByText("Sold Out Co")).not.toBeInTheDocument();
  });

  it("shows an em dash for an unpriced holding and says it isn't in the totals", async () => {
    handlers["GET /portfolio/summary"] = () => ({
      ...SUMMARY,
      holdings: [
        {
          ...SUMMARY.holdings[0],
          current_price: null,
          market_value: null,
          unrealized_pl: null,
          unrealized_pl_pct: null,
          weight: null,
        },
      ],
      unpriced_count: 1,
    });
    renderFresh();

    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
    expect(screen.getByText(/1 holding has no live price and isn't in these totals/i)).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the watchlist with prices", async () => {
    renderFresh();

    await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());
    expect(screen.getByText("702.40")).toBeInTheDocument();
  });

  it("shows an empty state and disables Log a trade when there are no holdings", async () => {
    handlers["GET /portfolio/summary"] = () => ({
      ...SUMMARY,
      holdings: [],
      watchlist: [],
      total_market_value: 0,
      total_cost_basis: 0,
      total_pl: 0,
      total_pl_pct: null,
    });
    renderFresh();

    await waitFor(() => expect(screen.getByText(/your portfolio is empty/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /log a trade/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /record snapshot/i })).toBeDisabled();
    expect(screen.queryByText(/start your history/i)).not.toBeInTheDocument();
  });

  it("shows an error instead of the chart when the snapshot history fails to load", async () => {
    handlers["GET /portfolio/snapshots"] = () => {
      throw new Error("boom");
    };
    renderFresh();

    await waitFor(() =>
      expect(screen.getByText("Could not load your value history.")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/start your history/i)).not.toBeInTheDocument();
    expect(screen.getByText("Apple Inc.")).toBeInTheDocument();
  });

  it("shows an inline error when the summary fails to load", async () => {
    handlers["GET /portfolio/summary"] = () => {
      throw new Error("boom");
    };
    renderFresh();

    await waitFor(() =>
      expect(screen.getByText(/could not load your portfolio/i)).toBeInTheDocument(),
    );
  });

  it("records a snapshot on request and refreshes the history", async () => {
    handlers["POST /portfolio/snapshot"] = () => ({ id: 1 });
    renderFresh();
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
    const before = count("GET /portfolio/snapshots");

    fireEvent.click(screen.getByRole("button", { name: /record snapshot/i }));

    await waitFor(() => expect(count("POST /portfolio/snapshot")).toBe(1));
    await waitFor(() => expect(count("GET /portfolio/snapshots")).toBeGreaterThan(before));
  });

  it("shows why a snapshot could not be recorded", async () => {
    handlers["POST /portfolio/snapshot"] = () => {
      throw new FakeApiError(500, "No current price available for MSFT");
    };
    renderFresh();
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /record snapshot/i }));

    await waitFor(() =>
      expect(screen.getByText("No current price available for MSFT")).toBeInTheDocument(),
    );
  });

  it("opens Log a trade with every holding selectable, including a sold-out one", async () => {
    renderFresh();
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /log a trade/i }));

    expect(screen.getByText(/this only records it here/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /OLD/ })).toBeInTheDocument();
  });

  it("opens a holding for editing when its row is clicked", async () => {
    renderFresh();
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Edit AAPL" }));

    expect(screen.getByRole("button", { name: /save holding/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove holding/i })).toBeInTheDocument();
  });

  it("adds a watchlist ticker and refreshes the summary", async () => {
    handlers["POST /portfolio/watchlist"] = () => ({});
    renderFresh();
    await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());
    const before = count("GET /portfolio/summary");

    fireEvent.change(screen.getByLabelText("Watchlist ticker"), { target: { value: "ko" } });
    fireEvent.click(screen.getByRole("button", { name: /add to watchlist/i }));

    await waitFor(() => expect(count("POST /portfolio/watchlist")).toBe(1));
    const post = apiFetch.mock.calls.find((c) => c[0] === "/portfolio/watchlist");
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
      ticker: "KO",
      asset_type: "STOCK",
    });
    await waitFor(() => expect(count("GET /portfolio/summary")).toBeGreaterThan(before));
  });
});
