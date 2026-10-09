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
    expect(screen.getByText("Portfolio value").parentElement).toHaveTextContent("3,900.00");
    expect(screen.getByText("Cost basis").parentElement).toHaveTextContent("3,500.00");
    expect(screen.getByText("Total P/L").parentElement).toHaveTextContent("+400.00");
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
      expect(within(row).queryByLabelText("from watchlist")).not.toBeInTheDocument();
      expect(screen.getByText("Weight / Target")).toBeInTheDocument();
    });

    it("takes the watchlist target when the holding has none, and marks where it comes from", async () => {
      handlers["GET /portfolio/summary"] = withTargets(null, [{ ticker: "AAPL", target_weight: 0.5 }]);
      renderFresh();
      const row = await screen.findByRole("button", { name: "Edit AAPL (target from watchlist)" });
      expect(row).toHaveTextContent("51.3% / 50%");
      expect(row).toHaveTextContent("10 sh · 51.3% / target 50% (watchlist)");
      expect(within(row).getByLabelText("from watchlist")).toBeInTheDocument();
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

  it("says an owned watchlist ticker keeps its target on the holding, with no target edit", async () => {
    handlers["GET /portfolio/summary"] = () => ({
      ...SUMMARY,
      watchlist: [
        { ticker: "AAPL", asset_type: "STOCK", note: null, target_weight: 0.3, current_price: 200 },
        { ticker: "ASML", asset_type: "STOCK", note: null, target_weight: 0.05, current_price: 702.4 },
      ],
    });
    renderFresh();
    expect(await screen.findByText("Owned · target on the holding")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit target for aapl/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove aapl from watchlist/i })).toBeInTheDocument();
    expect(screen.getByText("Watching · target 5%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit target for asml/i })).toBeInTheDocument();
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

  // The × button only asks; the dialog's Remove button does it.
  const confirmRemoval = () =>
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^remove$/i }));

  it("asks before removing a watchlist item, and does nothing until confirmed", async () => {
    renderFresh();
    await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove asml from watchlist/i }));

    expect(screen.getByRole("dialog")).toHaveTextContent(/remove asml from your watchlist\?/i);
    expect(count("DELETE /portfolio/watchlist/ASML")).toBe(0);
  });

  it("keeps the item when the dialog is cancelled", async () => {
    renderFresh();
    await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove asml from watchlist/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(count("DELETE /portfolio/watchlist/ASML")).toBe(0);
    expect(screen.getByText("ASML")).toBeInTheDocument();
  });

  it("removes a watchlist item once confirmed, and refreshes the list", async () => {
    handlers["DELETE /portfolio/watchlist/ASML"] = () => null;
    renderFresh();
    await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());
    const before = count("GET /portfolio/summary");

    fireEvent.click(screen.getByRole("button", { name: /remove asml from watchlist/i }));
    confirmRemoval();

    await waitFor(() => expect(count("DELETE /portfolio/watchlist/ASML")).toBe(1));
    await waitFor(() => expect(count("GET /portfolio/summary")).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("encodes the ticker when removing it", async () => {
    handlers["GET /portfolio/summary"] = () => ({
      ...SUMMARY,
      watchlist: [{ ticker: "^GSPC", asset_type: "ETF", note: null, current_price: 5000 }],
    });
    handlers["DELETE /portfolio/watchlist/%5EGSPC"] = () => null;
    renderFresh();
    await waitFor(() => expect(screen.getByText("^GSPC")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove \^gspc from watchlist/i }));
    confirmRemoval();

    await waitFor(() => expect(count("DELETE /portfolio/watchlist/%5EGSPC")).toBe(1));
  });

  it("keeps the item and says why when the removal fails", async () => {
    handlers["DELETE /portfolio/watchlist/ASML"] = () => {
      throw new FakeApiError(404, "Watchlist item not found");
    };
    renderFresh();
    await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove asml from watchlist/i }));
    confirmRemoval();

    expect(await screen.findByText(/watchlist item not found/i)).toBeInTheDocument();
    expect(screen.getByText("ASML")).toBeInTheDocument();
  });

  describe("adding to the watchlist", () => {
    const postedWatch = () => {
      const call = apiFetch.mock.calls.find((c) => c[0] === "/portfolio/watchlist" && c[1]?.method === "POST");
      return call ? JSON.parse(call[1].body) : null;
    };

    it("adds a holding to the watchlist from its row, with its own type, and refreshes", async () => {
      handlers["POST /portfolio/watchlist"] = () => ({ ticker: "AAPL" });
      renderFresh();
      await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
      const before = count("GET /portfolio/summary");

      fireEvent.click(screen.getByRole("button", { name: /add aapl to watchlist/i }));

      await waitFor(() => expect(postedWatch()).toEqual({ ticker: "AAPL", asset_type: "STOCK" }));
      await waitFor(() => expect(count("GET /portfolio/summary")).toBeGreaterThan(before));
    });

    it("does not send target_weight from the add-ticker row unless one was typed", async () => {
      handlers["POST /portfolio/watchlist"] = () => ({ ticker: "NVDA" });
      renderFresh();
      await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Watchlist ticker"), { target: { value: "nvda" } });
      fireEvent.click(screen.getByRole("button", { name: /^add to watchlist$/i }));

      await waitFor(() => expect(postedWatch()).toEqual({ ticker: "NVDA", asset_type: "STOCK" }));
    });

    it("saves the ISIN from an ISIN search after the watchlist add, but not once the ticker was edited", async () => {
      handlers["GET /market/search?q=IE00BKM4GZ66"] = () => [EIMI];
      handlers["POST /portfolio/watchlist"] = () => ({ ticker: "EIMI.L" });
      handlers["PUT /portfolio/instruments/EIMI.L/isin"] = () => ({ ticker: "EIMI.L", isin: "IE00BKM4GZ66" });
      renderFresh();
      await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Watchlist ticker"), { target: { value: "IE00BKM4GZ66" } });
      fireEvent.click(await screen.findByText("EIMI.L"));
      fireEvent.click(screen.getByRole("button", { name: /^add to watchlist$/i }));

      await waitFor(() => expect(postedWatch()).toEqual({ ticker: "EIMI.L", asset_type: "ETF" }));
      await waitFor(() => expect(count("PUT /portfolio/instruments/EIMI.L/isin")).toBe(1));
      const put = apiFetch.mock.calls.find((c) => c[1]?.method === "PUT")!;
      expect(JSON.parse(put[1].body)).toEqual({ isin: "IE00BKM4GZ66" });

      apiFetch.mockClear();
      handlers["GET /market/search?q=IE00BKM4GZ66"] = () => [EIMI];
      fireEvent.change(screen.getByLabelText("Watchlist ticker"), { target: { value: "IE00BKM4GZ66" } });
      fireEvent.click(await screen.findByText("EIMI.L"));
      fireEvent.change(screen.getByLabelText("Watchlist ticker"), { target: { value: "NVDA" } });
      fireEvent.click(screen.getByRole("button", { name: /^add to watchlist$/i }));

      await waitFor(() => expect(postedWatch()).toEqual({ ticker: "NVDA", asset_type: "ETF" }));
      // Settled: the add finished (field cleared), so a PUT would already have been sent.
      await waitFor(() => expect(screen.getByLabelText("Watchlist ticker")).toHaveValue(""));
      expect(count("PUT /portfolio/instruments/EIMI.L/isin")).toBe(0);
      expect(apiFetch.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(false);
    });

    it("sends a typed target as a fraction, and refuses one above 100", async () => {
      handlers["POST /portfolio/watchlist"] = () => ({ ticker: "NVDA" });
      renderFresh();
      await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Watchlist ticker"), { target: { value: "nvda" } });

      fireEvent.change(screen.getByLabelText("Target weight (%)"), { target: { value: "150" } });
      fireEvent.click(screen.getByRole("button", { name: /^add to watchlist$/i }));
      expect(postedWatch()).toBeNull();

      fireEvent.change(screen.getByLabelText("Target weight (%)"), { target: { value: "12.5" } });
      fireEvent.click(screen.getByRole("button", { name: /^add to watchlist$/i }));
      await waitFor(() => expect(postedWatch()).toEqual({ ticker: "NVDA", asset_type: "STOCK", target_weight: 0.125 }));
    });

    it("edits a saved target from the watchlist row", async () => {
      handlers["GET /portfolio/summary"] = () => ({
        ...SUMMARY,
        watchlist: [{ ticker: "ASML", asset_type: "STOCK", note: null, target_weight: 0.05, current_price: 702.4 }],
      });
      handlers["POST /portfolio/watchlist"] = () => ({ ticker: "ASML" });
      renderFresh();
      expect(await screen.findByText(/target 5%/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /edit target for asml/i }));
      const field = within(screen.getByRole("dialog")).getByLabelText("Target weight (%)") as HTMLInputElement;
      expect(field.value).toBe("5");
      fireEvent.change(field, { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: /save target/i }));

      await waitFor(() => expect(postedWatch()).toEqual({ ticker: "ASML", asset_type: "STOCK", target_weight: null }));
    });

    it("explains the icon with a tooltip", async () => {
      renderFresh();
      await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

      fireEvent.mouseOver(screen.getByRole("button", { name: /add aapl to watchlist/i }));

      expect(await screen.findByRole("tooltip")).toHaveTextContent("Add to watchlist");
    });

    it("shows a holding that is already watched as done, not as something to add", async () => {
      handlers["GET /portfolio/summary"] = () => ({
        ...SUMMARY,
        watchlist: [{ ticker: "AAPL", asset_type: "STOCK", note: null, current_price: 200 }],
      });
      renderFresh();
      await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

      expect(screen.queryByRole("button", { name: /add aapl to watchlist/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /aapl is on your watchlist/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /add msft to watchlist/i })).toBeEnabled();
    });

    it("still opens the editor when the row itself is tapped", async () => {
      renderFresh();
      await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Edit AAPL" }));

      expect(await screen.findByText("Save holding")).toBeInTheDocument();
    });

    it("will not add a ticker that is already on the watchlist, whatever the case", async () => {
      renderFresh();
      await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Watchlist ticker"), { target: { value: "asml" } });

      expect(screen.getByRole("button", { name: /^add to watchlist$/i })).toBeDisabled();
      expect(screen.getByText(/already on your watchlist/i)).toBeInTheDocument();
    });

    it("adds a searched ETF with the type the search gave it", async () => {
      handlers["GET /market/search?q=vwce"] = () => [
        { symbol: "VWCE.DE", name: "Vanguard FTSE All-World", type: "ETF", exchange: "XETRA" },
      ];
      handlers["POST /portfolio/watchlist"] = () => ({ ticker: "VWCE.DE" });
      renderFresh();
      await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Watchlist ticker"), { target: { value: "vwce" } });
      fireEvent.click(await screen.findByText("VWCE.DE", {}, { timeout: 3000 }));
      fireEvent.click(screen.getByRole("button", { name: /^add to watchlist$/i }));

      await waitFor(() => expect(postedWatch()).toEqual({ ticker: "VWCE.DE", asset_type: "ETF" }));
      expect(screen.getByLabelText("Watchlist type")).toHaveValue("ETF");
    });

    it("still adds a hand-typed ticker", async () => {
      handlers["POST /portfolio/watchlist"] = () => ({ ticker: "NEWONE" });
      renderFresh();
      await waitFor(() => expect(screen.getByText("ASML")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Watchlist ticker"), { target: { value: "newone" } });
      fireEvent.click(screen.getByRole("button", { name: /^add to watchlist$/i }));

      await waitFor(() => expect(postedWatch()).toEqual({ ticker: "NEWONE", asset_type: "STOCK" }));
    });
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

    // The page header has its own "Add holding" button; this is the one inside the first-holding form.
    const addHoldingButton = () =>
      within(screen.getByRole("form", { name: /first holding/i })).getByRole("button", { name: /^add holding$/i });

    function fillFirstHolding(ticker: string, shares: string, cost: string) {
      fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: ticker } });
      fireEvent.change(screen.getByLabelText("Shares"), { target: { value: shares } });
      fireEvent.change(screen.getByLabelText("Average cost"), { target: { value: cost } });
    }

    it("asks what you own with an inline form, and disables Log a trade and Record snapshot", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      renderFresh();

      expect(await screen.findByText(/what do you own/i)).toBeInTheDocument();
      expect(screen.getByLabelText("Ticker")).toBeInTheDocument();
      expect(screen.getByText(/nothing is bought or sold/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /log a trade/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /record snapshot/i })).toBeDisabled();
    });

    it("saves the first holding with sensible defaults and refreshes the portfolio", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      handlers["POST /portfolio/holdings"] = () => ({ id: 1 });
      renderFresh();
      await screen.findByText(/what do you own/i);
      const before = count("GET /portfolio/summary");

      fillFirstHolding(" aapl ", "10", "150");
      fireEvent.click(addHoldingButton());

      await waitFor(() => expect(count("POST /portfolio/holdings")).toBe(1));
      const post = apiFetch.mock.calls.find((c) => c[0] === "/portfolio/holdings" && c[1]?.method === "POST")!;
      expect(JSON.parse(post[1].body)).toEqual({
        ticker: "AAPL",
        name: "AAPL",
        asset_type: "STOCK",
        shares: 10,
        cost_basis: 150,
        first_purchase_date: new Date().toISOString().slice(0, 10),
        sector: null,
        target_weight: null,
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

      fillFirstHolding("VWCE", "3", "100.5");
      fireEvent.click(screen.getByRole("button", { name: /name, type and first purchase date/i }));
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

    it("does not save without a ticker, shares and an average cost", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      renderFresh();
      await screen.findByText(/what do you own/i);

      fillFirstHolding("AAPL", "0", "150");
      fireEvent.click(addHoldingButton());

      expect(await screen.findByText(/enter a ticker, shares and an average cost/i)).toBeInTheDocument();
      expect(count("POST /portfolio/holdings")).toBe(0);
    });

    it("shows the backend's reason when saving fails", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      handlers["POST /portfolio/holdings"] = () => {
        throw new FakeApiError(422, "Invalid ticker");
      };
      renderFresh();
      await screen.findByText(/what do you own/i);

      fillFirstHolding("???", "1", "1");
      fireEvent.click(addHoldingButton());

      expect(await screen.findByText(/invalid ticker/i)).toBeInTheDocument();
    });

    it("titles the side panel 'Or just watch' until something is watched", async () => {
      handlers["GET /portfolio/summary"] = () => EMPTY;
      renderFresh();

      expect(await screen.findByText(/or just watch/i)).toBeInTheDocument();
    });

    it("keeps the form and calls the panel 'Watchlist' when only a watchlist exists", async () => {
      handlers["GET /portfolio/summary"] = () => ({ ...EMPTY, watchlist: SUMMARY.watchlist });
      renderFresh();

      expect(await screen.findByText(/what do you own/i)).toBeInTheDocument();
      expect(screen.getByText("Watchlist")).toBeInTheDocument();
      expect(screen.queryByText(/or just watch/i)).not.toBeInTheDocument();
      expect(screen.getByText("ASML")).toBeInTheDocument();
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
