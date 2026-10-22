import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
  watchlist: [{ ticker: "ASML", asset_type: "STOCK", note: null, target_weight: null, current_price: 702.4 }],
  total_market_value: 3900,
  total_cost_basis: 3500,
  total_pl: 400,
  total_pl_pct: 11.4,
  unpriced_count: 0,
};

const SNAPSHOTS: Snapshot[] = [];
const EIMI = { symbol: "EIMI.L", name: "iShares Core MSCI EM IMI", type: "ETF", exchange: "LSE" };

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
    expect(screen.getByText("Total value").parentElement).toHaveTextContent("3,900.00");
    expect(screen.getByText("Total gain or loss").parentElement).toHaveTextContent("+400.00");
    expect(screen.getByText("Today").parentElement).toHaveTextContent("Not available");
    expect(screen.getByText(/mixed currencies are not converted/i)).toBeInTheDocument();
    expect(screen.getByText("Microsoft")).toBeInTheDocument();
    expect(screen.queryByText("Sold Out Co")).not.toBeInTheDocument();
  });

  it("shows the view strip with Holdings current, and no separate plan link", async () => {
    renderFresh();
    await screen.findByText("Apple Inc.");
    expect(screen.getByRole("heading", { level: 1, name: "Portfolio" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Portfolio views" });
    expect(within(nav).getByRole("link", { name: "Holdings" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /^This month/ })).toHaveAttribute("href", "/portfolio/plan");
    expect(screen.queryByText(/plan this month's contribution/i)).not.toBeInTheDocument();
  });

  describe("avg cost in the Shares cell", () => {
    it("shows the average cost as the second line, with no Avg cost column", async () => {
      handlers["GET /portfolio/summary"] = () => ({
        ...SUMMARY,
        holdings: [{ ...SUMMARY.holdings[0], shares: 3, cost_basis: 1492.38 }],
      });
      renderFresh();
      const row = await screen.findByRole("button", { name: "Edit AAPL" });
      expect(within(row).getByText("avg 1,492.38")).toBeInTheDocument();
      expect(screen.queryByText("Avg cost")).not.toBeInTheDocument();
      expect(screen.getByText("Shares")).toBeInTheDocument();
    });

    it("shows the dash when there is no usable cost basis", async () => {
      handlers["GET /portfolio/summary"] = () => ({
        ...SUMMARY,
        holdings: [{ ...SUMMARY.holdings[0], cost_basis: null as unknown as number }],
      });
      renderFresh();
      const row = await screen.findByRole("button", { name: "Edit AAPL" });
      expect(within(row).getByText("avg —")).toBeInTheDocument();
    });
  });

  describe("weight and target", () => {
    const withTargets = (aapl: number | null, watch: { ticker: string; target_weight: number | null }[]) => () => ({
      ...SUMMARY,
      holdings: [{ ...SUMMARY.holdings[0], target_weight: aapl }, SUMMARY.holdings[1]],
      watchlist: watch.map((w) => ({ ...w, asset_type: "STOCK", note: null, current_price: 1 })),
    });

    it("shows the holding's own target next to its weight, on desktop and on the phone line", async () => {
      handlers["GET /portfolio/summary"] = withTargets(0.51, []);
      renderFresh();
      const row = await screen.findByRole("button", { name: "Edit AAPL" });
      expect(row).toHaveTextContent("10 sh · 51.3% / target 51%");
      expect(row).toHaveTextContent("51.3% / 51%");
      expect(within(row).queryByLabelText("set on Discover")).not.toBeInTheDocument();
      expect(screen.getByText("Weight / Target")).toBeInTheDocument();
    });

    it("takes the target saved on Discover when the holding has none, as the plan does, and marks where it comes from", async () => {
      handlers["GET /portfolio/summary"] = withTargets(null, [{ ticker: "AAPL", target_weight: 0.5 }]);
      renderFresh();
      const row = await screen.findByRole("button", { name: "Edit AAPL (target set on Discover)" });
      expect(row).toHaveTextContent("51.3% / 50%");
      expect(row).toHaveTextContent("10 sh · 51.3% / target 50% (Discover)");
      expect(within(row).getByLabelText("set on Discover")).toBeInTheDocument();
    });

    it("offers Set target when there is no target, which opens the holding form", async () => {
      renderFresh();
      const row = await screen.findByRole("button", { name: "Edit MSFT" });
      expect(row).toHaveTextContent("5 sh · 48.7% · Set target");
      fireEvent.click(within(row).getAllByText("Set target")[0]);
      expect(await screen.findByRole("button", { name: /save holding/i })).toBeInTheDocument();
    });

    it("shows the dash for a holding without a weight", async () => {
      handlers["GET /portfolio/summary"] = () => ({
        ...SUMMARY,
        holdings: [{ ...SUMMARY.holdings[0], weight: null, target_weight: 0.2 }],
      });
      renderFresh();
      const row = await screen.findByRole("button", { name: "Edit AAPL" });
      expect(row).toHaveTextContent("10 sh · — / target 20%");
    });

    it("rounds the phone line's shares to one decimal but keeps the full count in the Shares column", async () => {
      handlers["GET /portfolio/summary"] = () => ({
        ...SUMMARY,
        holdings: [{ ...SUMMARY.holdings[0], shares: 1.407274, target_weight: 0.51 }],
      });
      renderFresh();
      const row = await screen.findByRole("button", { name: "Edit AAPL" });
      expect(row).toHaveTextContent("1.4 sh · 51.3% / target 51%");
      expect(within(row).getByText("1.407274")).toBeInTheDocument();
    });
  });

  describe("risk and analytics", () => {
    const ANALYTICS = {
      as_of: "2026-10-22T10:00:00Z",
      total_value_eur: 3900,
      positions: [
        { ticker: "AAPL", name: "Apple Inc.", value_eur: 2000, weight: 0.513, currency: "USD", price: 200, price_as_of: null, stale: false },
        { ticker: "MSFT", name: "Microsoft", value_eur: 1900, weight: 0.487, currency: "USD", price: 380, price_as_of: null, stale: false },
      ],
      by_sector: [{ label: "Technology", weight: 1 }],
      by_industry: [],
      by_country: [{ label: "United States", weight: 1 }],
      by_currency: [{ label: "USD", weight: 1 }],
      top_position_weight: 0.513,
      hhi: 0.5,
      effective_n: 2,
      volatility_annualized: 0.2,
      max_drawdown_1y: -0.15,
      correlation: { AAPL: { AAPL: 1, MSFT: 0.5 }, MSFT: { AAPL: 0.5, MSFT: 1 } },
      skipped: {},
      notes: [],
    };

    it("shows the measured risk for the open holdings", async () => {
      handlers["GET /portfolio/analytics"] = () => ANALYTICS;
      renderFresh();

      const panel = await screen.findByRole("region", { name: "Risk and analytics" });
      await waitFor(() => expect(within(panel).getByText("Volatility").parentElement).toHaveTextContent("20.0% a year"));
      expect(within(panel).getByText("Largest position").parentElement).toHaveTextContent("Apple Inc.");
      expect(count("GET /portfolio/analytics")).toBe(1);
    });

    it("says the figures could not be calculated, and asks again only when told to", async () => {
      renderFresh(); // /portfolio/analytics is not handled here: the request fails
      expect(await screen.findByText(/could not be calculated right now/i)).toBeInTheDocument();
      expect(count("GET /portfolio/analytics")).toBe(1); // not retried in a loop

      handlers["GET /portfolio/analytics"] = () => ANALYTICS;
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      await waitFor(() => expect(count("GET /portfolio/analytics")).toBe(2));
      expect(await screen.findByText("Volatility")).toBeInTheDocument();
    });

    it("reads the figures again when a holding changes", async () => {
      handlers["GET /portfolio/analytics"] = () => ANALYTICS;
      handlers["DELETE /portfolio/holdings/MSFT"] = () => {
        handlers["GET /portfolio/summary"] = () => ({ ...SUMMARY, holdings: [SUMMARY.holdings[0], SUMMARY.holdings[2]] });
        return undefined;
      };
      renderFresh();
      await screen.findByRole("region", { name: "Risk and analytics" });
      await waitFor(() => expect(count("GET /portfolio/analytics")).toBe(1));

      fireEvent.click(screen.getByRole("button", { name: "Actions for MSFT" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove holding" }));
      fireEvent.click(await screen.findByRole("button", { name: "Remove holding" }));

      await waitFor(() => expect(count("GET /portfolio/analytics")).toBe(2));
    });

    it("keeps the previous figures on screen, marked as updating, while a changed holding is measured again", async () => {
      let calls = 0;
      handlers["GET /portfolio/analytics"] = () => (++calls === 1 ? ANALYTICS : new Promise(() => {})); // the second never answers
      handlers["DELETE /portfolio/holdings/MSFT"] = () => {
        handlers["GET /portfolio/summary"] = () => ({ ...SUMMARY, holdings: [SUMMARY.holdings[0], SUMMARY.holdings[2]] });
        return undefined;
      };
      renderFresh();
      const panel = await screen.findByRole("region", { name: "Risk and analytics" });
      await waitFor(() => expect(within(panel).getByText("Volatility").parentElement).toHaveTextContent("20.0% a year"));

      fireEvent.click(screen.getByRole("button", { name: "Actions for MSFT" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove holding" }));
      fireEvent.click(await screen.findByRole("button", { name: "Remove holding" }));

      await waitFor(() => expect(count("GET /portfolio/analytics")).toBe(2));
      expect(within(panel).getByText("Volatility").parentElement).toHaveTextContent("20.0% a year");
      expect(await within(panel).findByText(/Updating these figures/)).toBeInTheDocument();
      expect(panel.querySelector("[aria-busy='true']")).toHaveTextContent("Volatility"); // dimmed figures, not a skeleton
    });

    it("is not requested for a portfolio with no open holding", async () => {
      handlers["GET /portfolio/summary"] = () => ({ ...SUMMARY, holdings: [SUMMARY.holdings[2]], watchlist: [] });
      renderFresh();
      await screen.findByText("Add your first holding");

      expect(count("GET /portfolio/analytics")).toBe(0);
      expect(screen.queryByRole("region", { name: "Risk and analytics" })).not.toBeInTheDocument();
    });
  });

  describe("row menu", () => {
    const openMenu = (ticker: string) => fireEvent.click(screen.getByRole("button", { name: `Actions for ${ticker}` }));

    it("opens the holding form from Edit holding", async () => {
      renderFresh();
      await screen.findByText("Apple Inc.");

      openMenu("AAPL");
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit holding" }));

      expect(await screen.findByText("Edit AAPL")).toBeInTheDocument();
    });

    it("opens the trade sheet for that holding from Log a trade", async () => {
      renderFresh();
      await screen.findByText("Apple Inc.");

      openMenu("MSFT");
      fireEvent.click(screen.getByRole("menuitem", { name: "Log a trade" }));

      const ticker = (await screen.findByLabelText("Ticker")) as HTMLSelectElement;
      expect(ticker.value).toBe("MSFT");
    });

    it("asks before removing, says it sells nothing, and refreshes the portfolio after", async () => {
      handlers["DELETE /portfolio/holdings/MSFT"] = () => undefined;
      renderFresh();
      await screen.findByText("Apple Inc.");
      const before = count("GET /portfolio/summary");

      openMenu("MSFT");
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove holding" }));
      expect(await screen.findByText("Remove MSFT?")).toBeInTheDocument();
      expect(screen.getByText(/does not sell anything/i)).toBeInTheDocument();
      expect(count("DELETE /portfolio/holdings/MSFT")).toBe(0); // nothing is removed until it is confirmed
      fireEvent.click(screen.getByRole("button", { name: "Remove holding" }));

      await waitFor(() => expect(count("DELETE /portfolio/holdings/MSFT")).toBe(1));
      await waitFor(() => expect(count("GET /portfolio/summary")).toBeGreaterThan(before));
    });

    it("keeps the holding when Keep it is pressed", async () => {
      renderFresh();
      await screen.findByText("Apple Inc.");

      openMenu("MSFT");
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove holding" }));
      fireEvent.click(await screen.findByRole("button", { name: "Keep it" }));

      await waitFor(() => expect(screen.queryByText("Remove MSFT?")).not.toBeInTheDocument());
      expect(count("DELETE /portfolio/holdings/MSFT")).toBe(0);
      expect(screen.getByText("Microsoft")).toBeInTheDocument();
    });
  });

  it("offers Add purchase price where a holding has no cost, in place of an empty gain", async () => {
    handlers["GET /portfolio/summary"] = () => ({
      ...SUMMARY,
      holdings: [
        SUMMARY.holdings[0],
        { ...SUMMARY.holdings[1], cost_basis: null, unrealized_pl: null, unrealized_pl_pct: null },
      ],
    });
    renderFresh();
    await screen.findByText("Apple Inc.");

    // Once in the desktop cell and once on the phone line; the row still opens the holding form.
    expect(screen.getAllByText("Add purchase price").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText("Add purchase price")[0]);
    expect(await screen.findByText("Edit MSFT")).toBeInTheDocument();
  });

  describe("allocation", () => {
    const withSectors = () => {
      handlers["GET /portfolio/summary"] = () => ({
        ...SUMMARY,
        holdings: [
          { ...SUMMARY.holdings[0], sector: "Technology", country: "United States", currency: "USD" },
          { ...SUMMARY.holdings[1], sector: "Utilities", country: "United Kingdom", currency: "GBP" },
          SUMMARY.holdings[2],
        ],
      });
    };

    it("shows the allocation by sector, and the largest positions", async () => {
      withSectors();
      renderFresh();

      const panel = await screen.findByRole("region", { name: "Allocation" });
      expect(within(panel).getByRole("button", { name: /Technology/ })).toHaveTextContent("51.3%");
      expect(within(panel).getByRole("button", { name: /Utilities/ })).toHaveTextContent("48.7%");
      expect(within(panel).getByRole("heading", { name: "Largest positions" })).toBeInTheDocument();
    });

    it("filters the holdings to the group a legend row selects, and shows all again", async () => {
      withSectors();
      renderFresh();
      await screen.findByText("Apple Inc.");
      expect(screen.getByText("Microsoft")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Utilities/ }));

      expect(screen.queryByText("Apple Inc.")).not.toBeInTheDocument();
      expect(screen.getByText("Microsoft")).toBeInTheDocument();
      expect(screen.getByText(/Showing holdings in Utilities/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Show all" }));
      expect(screen.getByText("Apple Inc.")).toBeInTheDocument();
      expect(screen.queryByText(/Showing holdings in/)).not.toBeInTheDocument();
    });

    it("counts the holdings, and how many are shown while a group filters them", async () => {
      withSectors();
      renderFresh();
      await screen.findByText("Apple Inc.");
      const panel = screen.getByRole("region", { name: "Your holdings" });
      expect(within(panel).getByText("2 holdings")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Utilities/ }));

      expect(within(panel).getByText("1 of 2 holdings")).toBeInTheDocument();
    });

    it("clears the filter when the grouping changes", async () => {
      withSectors();
      renderFresh();
      await screen.findByText("Apple Inc.");
      fireEvent.click(screen.getByRole("button", { name: /Utilities/ }));
      expect(screen.queryByText("Apple Inc.")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Country" }));

      expect(screen.getByText("Apple Inc.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /United Kingdom/ })).toHaveAttribute("aria-pressed", "false");
    });

    it("keeps a holding with no live price in the table when its group is selected", async () => {
      handlers["GET /portfolio/summary"] = () => ({
        ...SUMMARY,
        holdings: [
          { ...SUMMARY.holdings[0], sector: "Technology" },
          { ...SUMMARY.holdings[1], sector: "Technology", current_price: null, market_value: null, unrealized_pl: null, unrealized_pl_pct: null, weight: null },
        ],
      });
      renderFresh();
      await screen.findByText("Apple Inc.");

      fireEvent.click(screen.getByRole("button", { name: /Technology/ }));

      expect(screen.getByText("Apple Inc.")).toBeInTheDocument();
      expect(screen.getByText("Microsoft")).toBeInTheDocument(); // unpriced, but still a Technology holding
    });

    it("filters by currency too, and pressing the same row again clears it", async () => {
      withSectors();
      renderFresh();
      await screen.findByText("Apple Inc.");

      fireEvent.click(screen.getByRole("button", { name: "Currency" }));
      fireEvent.click(screen.getByRole("button", { name: /GBP/ }));
      expect(screen.queryByText("Apple Inc.")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /GBP/ }));

      expect(screen.getByText("Apple Inc.")).toBeInTheDocument();
    });
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

  it.each([0, 1])("labels cost coverage when %i holdings have usable purchase costs", async (covered) => {
    handlers["GET /portfolio/summary"] = () => ({ ...SUMMARY,
      pl_covered_count: covered, pl_complete: false, unknown_basis_count: 1,
      total_cost_basis: covered ? 1500 : 0,
    });
    renderFresh();
    const gain = (await screen.findByText("Total gain or loss")).parentElement!;
    if (covered === 0) {
      expect(gain).toHaveTextContent("Not available");
      expect(gain).toHaveTextContent("Add purchase prices to see it");
      expect(gain).not.toHaveTextContent("0.00");
    } else {
      expect(gain).toHaveTextContent("+400.00");
      expect(gain).toHaveTextContent("1 holding without a purchase price is left out");
    }
  });

  it("requires Update position for a closed holding and preserves blank purchase details", async () => {
    handlers["POST /portfolio/holdings"] = () => ({ id: 1 });
    renderFresh();
    await screen.findByText("Apple Inc.");
    fireEvent.click(screen.getByRole("button", { name: /^add holding$/i }));
    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "old" } });
    fireEvent.change(screen.getByLabelText("Shares"), { target: { value: "2.5" } });
    expect(screen.getByText(/you already hold OLD/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update position" }));
    await waitFor(() => expect(count("POST /portfolio/holdings")).toBe(1));
    const post = apiFetch.mock.calls.find((c) => c[0] === "/portfolio/holdings" && c[1]?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toEqual({ ticker: "OLD", shares: 2.5 });
  });

  it("does not label a missing price as a stale quote", async () => {
    handlers["GET /portfolio/summary"] = () => ({ ...SUMMARY, unpriced_count: 1,
      holdings: [{ ...SUMMARY.holdings[0], current_price: null, market_value: null,
        stale: true, as_of: null }],
    });
    renderFresh();
    await screen.findByText("AAPL");
    expect(screen.queryByText("Quote date unavailable")).not.toBeInTheDocument();
  });

  it("shows unknown basis and stale-quote coverage without inventing a gain", async () => {
    handlers["GET /portfolio/summary"] = () => ({
      ...SUMMARY, holdings: [{ ...SUMMARY.holdings[0], cost_basis: null, unrealized_pl: null,
        unrealized_pl_pct: null, stale: true, as_of: "2024-01-01" }],
      unknown_basis_count: 1, pl_covered_count: 0, pl_complete: false,
      total_pl: 0, total_pl_pct: null, total_cost_basis: 0,
    });
    renderFresh();
    expect(await screen.findByText(/Add purchase prices to see it/)).toBeInTheDocument();
    expect(screen.getByText("Stale quote · 2024-01-01")).toBeInTheDocument();
    expect(screen.getByText("avg —")).toBeInTheDocument();
  });

  describe("empty portfolio", () => {
    const EMPTY: PortfolioSummary = {
      ...SUMMARY,
      holdings: [],
      watchlist: [],
      total_market_value: 0,
      total_cost_basis: 0,
      total_pl: 0,
      total_pl_pct: null,
    };

    const addHoldingButton = () => screen.getByRole("button", { name: /^save holding$/i });
    function openFirstHolding() {
      fireEvent.click(screen.getByRole("button", { name: "Add your first holding" }));
      fireEvent.click(screen.getByRole("button", { name: /purchase details and overrides/i }));
    }

    function fillFirstHolding(ticker: string, shares: string, cost: string) {
      fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: ticker } });
      fireEvent.change(screen.getByLabelText("Shares"), { target: { value: shares } });
      fireEvent.change(screen.getByLabelText("Average cost"), { target: { value: cost } });
    }

    it("opens the first holding in a modal", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      renderFresh();

      expect(await screen.findByText(/what do you own/i)).toBeInTheDocument();
      expect(screen.getByText(/nothing is bought or sold/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /log a trade/i })).not.toBeInTheDocument();
      openFirstHolding();
      expect(screen.getByLabelText("Ticker")).toBeInTheDocument();
    });

    it("saves the first holding with sensible defaults and refreshes the portfolio", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      handlers["POST /portfolio/holdings"] = () => ({ id: 1 });
      renderFresh();
      await screen.findByText(/what do you own/i);
      openFirstHolding();
      const before = count("GET /portfolio/summary");

      fillFirstHolding(" aapl ", "10", "150");
      fireEvent.click(addHoldingButton());

      await waitFor(() => expect(count("POST /portfolio/holdings")).toBe(1));
      const post = apiFetch.mock.calls.find((c) => c[0] === "/portfolio/holdings" && c[1]?.method === "POST")!;
      expect(JSON.parse(post[1].body)).toEqual({
        ticker: "AAPL",
        shares: 10,
        cost_basis: 150,
      });
      await waitFor(() => expect(count("GET /portfolio/summary")).toBeGreaterThan(before));
    });

    it("saves the ISIN from an ISIN search after the first holding, and the add stands when that fails", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      handlers["GET /market/search?q=IE00BKM4GZ66"] = () => [EIMI];
      handlers["POST /portfolio/holdings"] = () => ({ id: 1 });
      handlers["PUT /portfolio/instruments/EIMI.L/isin"] = () => {
        throw new FakeApiError(422, "Not a valid ISIN: 12 characters with a correct check digit.");
      };
      renderFresh();
      await screen.findByText(/what do you own/i);
      openFirstHolding();

      fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "IE00BKM4GZ66" } });
      fireEvent.click(await screen.findByText("EIMI.L"));
      fireEvent.change(screen.getByLabelText("Shares"), { target: { value: "3" } });
      fireEvent.change(screen.getByLabelText("Average cost"), { target: { value: "30" } });
      fireEvent.click(addHoldingButton());

      await waitFor(() => expect(count("PUT /portfolio/instruments/EIMI.L/isin")).toBe(1));
      const post = apiFetch.mock.calls.find((c) => c[0] === "/portfolio/holdings" && c[1]?.method === "POST")!;
      expect(JSON.parse(post[1].body)).not.toHaveProperty("isin");
      const put = apiFetch.mock.calls.find((c) => c[1]?.method === "PUT")!;
      expect(JSON.parse(put[1].body)).toEqual({ isin: "IE00BKM4GZ66" });
    });

    it("does not save the ISIN when the first holding's ticker was edited after the pick", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      handlers["GET /market/search?q=IE00BKM4GZ66"] = () => [EIMI];
      handlers["POST /portfolio/holdings"] = () => ({ id: 1 });
      renderFresh();
      await screen.findByText(/what do you own/i);
      openFirstHolding();
      const before = count("GET /portfolio/summary");

      fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "IE00BKM4GZ66" } });
      fireEvent.click(await screen.findByText("EIMI.L"));
      fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "SXR8.DE" } });
      fireEvent.change(screen.getByLabelText("Shares"), { target: { value: "3" } });
      fireEvent.change(screen.getByLabelText("Average cost"), { target: { value: "30" } });
      fireEvent.click(addHoldingButton());

      await waitFor(() => expect(count("GET /portfolio/summary")).toBeGreaterThan(before));
      expect(count("POST /portfolio/holdings")).toBe(1);
      expect(apiFetch.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(false);
    });

    it("sends the optional name, type and date when they are filled in", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      handlers["POST /portfolio/holdings"] = () => ({ id: 1 });
      renderFresh();
      await screen.findByText(/what do you own/i);
      openFirstHolding();

      fillFirstHolding("VWCE", "3", "100.5");
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vanguard All-World" } });
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "ETF" } });
      fireEvent.change(screen.getByLabelText("First purchase date"), { target: { value: "2024-03-01" } });
      fireEvent.click(addHoldingButton());

      await waitFor(() => expect(count("POST /portfolio/holdings")).toBe(1));
      const post = apiFetch.mock.calls.find((c) => c[0] === "/portfolio/holdings" && c[1]?.method === "POST")!;
      expect(JSON.parse(post[1].body)).toMatchObject({
        ticker: "VWCE",
        name: "Vanguard All-World",
        asset_type: "ETF",
        first_purchase_date: "2024-03-01",
      });
    });

    it("fills the ticker, name and type from a search result", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      handlers["GET /market/search?q=vwce"] = () => [
        { symbol: "VWCE.DE", name: "Vanguard FTSE All-World", type: "ETF", exchange: "XETRA" },
      ];
      handlers["POST /portfolio/holdings"] = () => ({ id: 1 });
      renderFresh();
      await screen.findByText(/what do you own/i);
      openFirstHolding();

      fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "vwce" } });
      fireEvent.click(await screen.findByText("VWCE.DE", {}, { timeout: 3000 }));
      fireEvent.change(screen.getByLabelText("Shares"), { target: { value: "3" } });
      fireEvent.change(screen.getByLabelText("Average cost"), { target: { value: "100" } });
      fireEvent.click(addHoldingButton());

      await waitFor(() => expect(count("POST /portfolio/holdings")).toBe(1));
      const post = apiFetch.mock.calls.find((c) => c[0] === "/portfolio/holdings" && c[1]?.method === "POST")!;
      expect(JSON.parse(post[1].body)).toMatchObject({
        ticker: "VWCE.DE",
        name: "Vanguard FTSE All-World",
        asset_type: "ETF",
      });
    });

    it("does not save with zero shares", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      renderFresh();
      await screen.findByText(/what do you own/i);
      openFirstHolding();

      fillFirstHolding("AAPL", "0", "150");
      fireEvent.click(addHoldingButton());

      expect(await screen.findByText(/enter a ticker and valid shares/i)).toBeInTheDocument();
      expect(count("POST /portfolio/holdings")).toBe(0);
    });

    it("shows the backend's reason when saving fails", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      handlers["POST /portfolio/holdings"] = () => {
        throw new FakeApiError(422, "Invalid ticker");
      };
      renderFresh();
      await screen.findByText(/what do you own/i);
      openFirstHolding();

      fillFirstHolding("???", "1", "1");
      fireEvent.click(addHoldingButton());

      expect(await screen.findByText(/invalid ticker/i)).toBeInTheDocument();
    });

    it("does not show the first-holding form once there is a holding", async () => {
      renderFresh();

      await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
      expect(screen.queryByText(/what do you own/i)).not.toBeInTheDocument();
    });
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

  it("has no watchlist on the page, and no Log a trade or Record snapshot in the header (the row menu still has Log a trade)", async () => {
    renderFresh();
    await screen.findByText("Apple Inc.");

    expect(screen.queryByText("Watchlist")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Watchlist ticker")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to watchlist/i })).not.toBeInTheDocument();
    expect(screen.queryByText("ASML")).not.toBeInTheDocument(); // only on the saved list, not a holding
    expect(screen.queryByRole("button", { name: "Log a trade" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record snapshot/i })).not.toBeInTheDocument(); // saved on its own each day
    expect(screen.getByRole("button", { name: "Add holding" })).toBeInTheDocument();
  });

  it("opens a holding for editing when its row is clicked", async () => {
    renderFresh();
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Edit AAPL" }));

    expect(screen.getByRole("button", { name: /save holding/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove holding/i })).toBeInTheDocument();
  });

});
