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
});
