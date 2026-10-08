// frontend/components/portfolio/HoldingForm.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { HoldingSummary } from "@/lib/api/portfolio-types";

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

import { HoldingForm } from "./HoldingForm";

const HELD: HoldingSummary = {
  ticker: "AAPL",
  name: "Apple Inc.",
  asset_type: "STOCK",
  shares: 10,
  cost_basis: 150,
  first_purchase_date: "2024-01-15",
  sector: "Technology",
  target_weight: 0.2,
  current_price: 200,
  market_value: 2000,
  unrealized_pl: 500,
  unrealized_pl_pct: 33,
  weight: 1,
};

function setup(props: Partial<React.ComponentProps<typeof HoldingForm>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<HoldingForm open onClose={onClose} heldTickers={[]} onSaved={onSaved} {...props} />);
  return { onClose, onSaved };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function sentBody() {
  return JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string);
}

describe("HoldingForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a holding with an upper-cased ticker", async () => {
    apiFetch.mockResolvedValue({});
    const { onSaved, onClose } = setup();

    type("Ticker", "vwce.de");
    type("Name", "Vanguard FTSE All-World");
    type("Type", "ETF");
    type("Shares", "40");
    type("Average cost", "112.8");
    type("First purchase date", "2024-01-10");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0][0]).toBe("/portfolio/holdings");
    expect(sentBody()).toEqual({
      ticker: "VWCE.DE",
      name: "Vanguard FTSE All-World",
      asset_type: "ETF",
      shares: 40,
      cost_basis: 112.8,
      first_purchase_date: "2024-01-10",
      sector: null,
      target_weight: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("fills the ticker, name and type from a search result", async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path.startsWith("/market/search")
        ? [{ symbol: "VWCE.DE", name: "Vanguard FTSE All-World", type: "ETF", exchange: "XETRA" }]
        : {},
    );
    const { onSaved } = setup();

    type("Ticker", "vwce");
    fireEvent.click(await screen.findByText("VWCE.DE", {}, { timeout: 3000 }));
    type("Shares", "40");
    type("Average cost", "112.8");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = apiFetch.mock.calls.find((c) => c[0] === "/portfolio/holdings")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({
      ticker: "VWCE.DE",
      name: "Vanguard FTSE All-World",
      asset_type: "ETF",
    });
    expect(screen.getByLabelText("Name")).toHaveValue("Vanguard FTSE All-World");
  });

  it("shows the saved target as a percentage and always sends the current one", async () => {
    apiFetch.mockResolvedValue({});
    const { onSaved } = setup({ holding: HELD });
    expect(screen.getByLabelText("Target weight (%)")).toHaveValue("20");

    type("Target weight (%)", "7.25");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sentBody().target_weight).toBe(0.0725);
  });

  it("sends null when the target is cleared, and refuses one above 100", async () => {
    apiFetch.mockResolvedValue({});
    const { onSaved } = setup({ holding: HELD });

    type("Target weight (%)", "101");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));
    expect(apiFetch).not.toHaveBeenCalled();

    type("Target weight (%)", "");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sentBody()).toHaveProperty("target_weight", null);
  });

  it("keeps the ticker locked while editing, with no search", () => {
    setup({ holding: HELD });

    expect(screen.getByLabelText("Ticker")).toBeDisabled();
  });

  it("prefills the ticker", () => {
    setup({ prefillTicker: "NVDA" });

    expect(screen.getByLabelText("Ticker")).toHaveValue("NVDA");
  });

  it("warns that adding a ticker already held replaces it", () => {
    setup({ heldTickers: ["AAPL"] });

    type("Ticker", "aapl");

    expect(screen.getByText(/you already hold AAPL/i)).toBeInTheDocument();
    expect(screen.getByText(/replaces its shares and average cost/i)).toBeInTheDocument();
  });

  it("edits in place: ticker locked, and sector, target weight and purchase date round-trip", async () => {
    apiFetch.mockResolvedValue({});
    const { onSaved } = setup({ holding: HELD, heldTickers: ["AAPL"] });

    expect(screen.getByLabelText("Ticker")).toBeDisabled();
    expect(screen.queryByText(/you already hold/i)).not.toBeInTheDocument();
    type("Shares", "12");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sentBody()).toEqual({
      ticker: "AAPL",
      name: "Apple Inc.",
      asset_type: "STOCK",
      shares: 12,
      cost_basis: 150,
      first_purchase_date: "2024-01-15",
      sector: "Technology",
      target_weight: 0.2,
    });
  });

  it("does not send a request when a required field is missing", () => {
    setup();

    type("Ticker", "AAPL");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    expect(screen.getByText(/enter a ticker, a name/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects 0 shares when adding a holding", () => {
    setup();

    type("Ticker", "AAPL");
    type("Name", "Apple");
    type("Shares", "0");
    type("Average cost", "10");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    expect(screen.getByText(/enter a ticker, a name/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("still sends 0 shares when editing (closing a position)", async () => {
    apiFetch.mockResolvedValue({});
    const { onSaved } = setup({ holding: HELD });

    type("Shares", "0");
    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sentBody().shares).toBe(0);
  });

  it("removes a holding only after an explicit confirm", async () => {
    apiFetch.mockResolvedValue(undefined);
    const { onSaved, onClose } = setup({ holding: HELD });

    fireEvent.click(screen.getByRole("button", { name: /remove holding/i }));
    expect(apiFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirm remove/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/portfolio/holdings/AAPL",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the backend's error inline and stays open", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(422, "Something is off"));
    const { onSaved } = setup({ holding: HELD });

    fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    await waitFor(() => expect(screen.getByText("Something is off")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("ignores a second click while the first save is in flight", async () => {
    let resolve!: (value: unknown) => void;
    apiFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    setup({ holding: HELD });

    const save = screen.getByRole("button", { name: /save holding/i });
    fireEvent.click(save);
    fireEvent.click(save);
    resolve({});

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });

  describe("adding by searching for an ISIN", () => {
    const EIMI = { symbol: "EIMI.L", name: "iShares Core MSCI EM IMI", type: "ETF", exchange: "LSE" };
    const puts = () => apiFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
    const posts = () => apiFetch.mock.calls.filter((c) => c[0] === "/portfolio/holdings");

    function mockApi(isinResult: () => Promise<unknown> = () => Promise.resolve({})) {
      apiFetch.mockImplementation((path: string) => {
        if (path.startsWith("/market/search")) return Promise.resolve([EIMI]);
        if (path.startsWith("/portfolio/instruments/")) return isinResult();
        return Promise.resolve({});
      });
    }

    async function pickByIsin() {
      fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "ie00bkm4gz66" } });
      fireEvent.click(await screen.findByText("EIMI.L"));
      type("Shares", "5");
      type("Average cost", "30");
    }
    const save = () => fireEvent.click(screen.getByRole("button", { name: /save holding/i }));

    it("posts the holding without the ISIN, then saves the ISIN on its own route", async () => {
      mockApi();
      const { onSaved, onClose } = setup();
      await pickByIsin();

      save();

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onSaved).toHaveBeenCalled();
      expect(posts()).toHaveLength(1);
      const body = JSON.parse((posts()[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({ ticker: "EIMI.L", name: "iShares Core MSCI EM IMI", asset_type: "ETF" });
      expect(body).not.toHaveProperty("isin");
      expect(puts()).toHaveLength(1);
      expect(puts()[0][0]).toBe("/portfolio/instruments/EIMI.L/isin");
      expect(JSON.parse((puts()[0][1] as RequestInit).body as string)).toEqual({ isin: "IE00BKM4GZ66" });
    });

    it("does not save the ISIN when the ticker was edited after the pick", async () => {
      mockApi();
      const { onClose } = setup();
      await pickByIsin();
      type("Ticker", "SXR8.DE");

      save();

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(posts()).toHaveLength(1);
      expect(puts()).toHaveLength(0);
    });

    it("keeps the holding and closes the form when the ISIN could not be saved", async () => {
      mockApi(() => Promise.reject(new FakeApiError(422, "Not a valid ISIN: 12 characters with a correct check digit.")));
      const { onSaved, onClose } = setup();
      await pickByIsin();

      save();

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onSaved).toHaveBeenCalled();
    });
  });
});
