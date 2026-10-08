import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

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

import { LogTradeCta } from "./LogTradeCta";

function renderFresh(recommendation: RecommendationOut) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <LogTradeCta recommendation={recommendation} />
    </SWRConfig>,
  );
}

function rec(overrides: Partial<RecommendationOut> = {}): RecommendationOut {
  return {
    id: 1,
    user_id: "u1",
    created_at: "2026-01-01T00:00:00",
    ticker: "AAPL",
    asset_type: "STOCK",
    action: "BUY",
    reasoning: [],
    ai_analysis: null,
    suggested_position_pct: null,
    status: "APPROVED",
    reviewed_at: null,
    fundamental_score: null,
    technical_signal: null,
    price_at_recommendation: null,
    current_price: null,
    price_change_pct: null,
    ...overrides,
  };
}

const SUMMARY: PortfolioSummary = {
  holdings: [
    {
      ticker: "AAPL",
      name: "Apple Inc.",
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
  total_pl_pct: 33,
  unpriced_count: 0,
};

function serve(summary: PortfolioSummary = SUMMARY) {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/portfolio/summary") return Promise.resolve(summary);
    if (path === "/portfolio/trades" && init?.method === "POST") return Promise.resolve({});
    return Promise.reject(new Error("unexpected " + path));
  });
}

describe("LogTradeCta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serve();
  });

  it("opens Log a trade with Bought and the ticker prefilled for a BUY of a held ticker", async () => {
    renderFresh(rec({ action: "BUY" }));

    fireEvent.click(await screen.findByRole("button", { name: /log the trade i placed/i }));

    expect(screen.getByLabelText("Ticker")).toHaveValue("AAPL");
    expect(screen.getByRole("button", { name: "Bought" })).toHaveAttribute("aria-pressed", "true");
  });

  it("prefills Sold for TRIM and SELL", async () => {
    renderFresh(rec({ action: "TRIM" }));

    fireEvent.click(await screen.findByRole("button", { name: /log the trade i placed/i }));

    expect(screen.getByRole("button", { name: "Sold" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows no button for HOLD or WATCH — there is nothing to record", async () => {
    const { container } = renderFresh(rec({ action: "HOLD" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the summary resolve
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the Add-holding form with the ticker prefilled for a BUY of a ticker not held", async () => {
    renderFresh(rec({ ticker: "NVDA", action: "BUY" }));

    fireEvent.click(await screen.findByRole("button", { name: /log the trade i placed/i }));

    expect(screen.getByRole("button", { name: /save holding/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Ticker")).toHaveValue("NVDA");
  });

  it("shows nothing for a SELL of a ticker that isn't held", async () => {
    const { container } = renderFresh(rec({ ticker: "NVDA", action: "SELL" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the summary resolve
    expect(container).toBeEmptyDOMElement();
  });

  it("confirms once the trade is logged", async () => {
    renderFresh(rec({ action: "BUY" }));

    fireEvent.click(await screen.findByRole("button", { name: /log the trade i placed/i }));
    fireEvent.change(screen.getByLabelText("Shares"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "121.6" } });
    fireEvent.click(screen.getByRole("button", { name: /save to log/i }));

    await waitFor(() => expect(screen.getByText(/trade logged/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /log the trade i placed/i })).not.toBeInTheDocument();
  });

  it("still shows the ISIN note after the Trade logged state replaces the form", async () => {
    const EIMI = { symbol: "EIMI.L", name: "iShares Core MSCI EM IMI", type: "ETF", exchange: "LSE" };
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/portfolio/summary") return Promise.resolve(SUMMARY);
      if (path.startsWith("/market/search")) return Promise.resolve([EIMI]);
      if (path === "/portfolio/holdings" && init?.method === "POST") return Promise.resolve({});
      if (path === "/portfolio/instruments/EIMI.L/isin")
        return Promise.reject(new FakeApiError(422, "Not a valid ISIN: 12 characters with a correct check digit."));
      return Promise.reject(new Error("unexpected " + path));
    });
    renderFresh(rec({ ticker: "NVDA", action: "BUY" }));
    fireEvent.click(await screen.findByRole("button", { name: /log the trade i placed/i }));

    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "IE00BKM4GZ66" } });
    fireEvent.click(await screen.findByText("EIMI.L"));
    fireEvent.change(screen.getByLabelText("Shares"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Average cost"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    expect(await screen.findByText("Trade logged.")).toBeInTheDocument();
    expect(
      await screen.findByText("Saved. The ISIN could not be saved: Not a valid ISIN: 12 characters with a correct check digit. Add it on a plan."),
    ).toBeInTheDocument();
  });
});
