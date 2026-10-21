import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import type { WatchlistSummary } from "@/lib/api/portfolio-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class extends Error {},
}));

import { WatchTargetDialog } from "./WatchTargetDialog";

const ITEM: WatchlistSummary = { ticker: "ASML", asset_type: "STOCK", note: null, target_weight: 0.072, current_price: 700 };

function setup(item = ITEM) {
  const onSaved = vi.fn();
  render(<WatchTargetDialog item={item} onClose={vi.fn()} onSaved={onSaved} />);
  return { onSaved };
}
const body = () => JSON.parse((apiFetch.mock.calls[0][1] as RequestInit).body as string);
const field = () => screen.getByLabelText("Target weight (%)") as HTMLInputElement;

describe("WatchTargetDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue({});
  });

  it("shows the saved fraction as a percentage and saves an edit as a fraction", async () => {
    const { onSaved } = setup();
    expect(field().value).toBe("7.2");
    fireEvent.change(field(), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: /save target/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toEqual({ ticker: "ASML", asset_type: "STOCK", target_weight: 0.125 });
  });

  it("sends an explicit null when the field is cleared", async () => {
    const { onSaved } = setup();
    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save target/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toHaveProperty("target_weight", null);
  });

  describe("target price range", () => {
    const low = () => screen.getByLabelText("Lowest price") as HTMLInputElement;
    const high = () => screen.getByLabelText("Highest price") as HTMLInputElement;
    const save = () => fireEvent.click(screen.getByRole("button", { name: /save target/i }));

    it("shows the saved range and leaves it out of the request when it did not change", async () => {
      const { onSaved } = setup({ ...ITEM, target_price_low: 90, target_price_high: 110.5 });
      expect([low().value, high().value]).toEqual(["90", "110.5"]);

      save();

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(body()).not.toHaveProperty("target_price_low");
      expect(body()).not.toHaveProperty("target_price_high");
    });

    it("saves a new range with both ends", async () => {
      const { onSaved } = setup();
      fireEvent.change(low(), { target: { value: "90" } });
      fireEvent.change(high(), { target: { value: "110,5" } });

      save();

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(body()).toMatchObject({ target_price_low: 90, target_price_high: 110.5 });
    });

    it("clears a saved range with two explicit nulls", async () => {
      const { onSaved } = setup({ ...ITEM, target_price_low: 90, target_price_high: 110 });
      fireEvent.change(low(), { target: { value: "" } });
      fireEvent.change(high(), { target: { value: "" } });

      save();

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(body()).toMatchObject({ target_price_low: null, target_price_high: null });
    });

    it("sends no range fields when there was none and none was typed", async () => {
      const { onSaved } = setup();

      save();

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(body()).not.toHaveProperty("target_price_low");
    });

    it("refuses one end alone, or a lowest price above the highest, without a request", () => {
      setup();
      fireEvent.change(low(), { target: { value: "90" } });
      save();
      expect(apiFetch).not.toHaveBeenCalled();
      expect(screen.getAllByText(/both ends of the range/i).length).toBeGreaterThan(0);

      fireEvent.change(high(), { target: { value: "80" } });
      save();
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("waits for the save before calling one end alone an error, but flags two ends that cannot be a range", () => {
      setup();
      fireEvent.change(low(), { target: { value: "90" } }); // the highest price is still to come
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(low()).toHaveAttribute("aria-invalid", "false");

      fireEvent.change(high(), { target: { value: "80" } });
      expect(low()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(/both ends of the range/i);
    });

    it("does not check or send a range that was not touched, even one the form cannot read back", async () => {
      const { onSaved } = setup({ ...ITEM, target_price_low: 0.0000001, target_price_high: 5 });

      save();

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(body()).not.toHaveProperty("target_price_low");
    });

    it("refreshes Today's watchlist insights once the range is saved", async () => {
      const fetcher = vi.fn().mockResolvedValue({ insights: [], missing: [] });
      function Probe() {
        useSWR("/portfolio/insights", fetcher);
        return null;
      }
      render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Probe />
          <WatchTargetDialog item={ITEM} onClose={vi.fn()} onSaved={vi.fn()} />
        </SWRConfig>,
      );
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      fireEvent.change(low(), { target: { value: "90" } });
      fireEvent.change(high(), { target: { value: "110" } });

      save();

      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    });

    it("with range only, hides the weight field and never sends the weight", async () => {
      const onSaved = vi.fn();
      render(<WatchTargetDialog item={{ ...ITEM, target_weight: 0.3 }} rangeOnly onClose={vi.fn()} onSaved={onSaved} />);
      expect(screen.queryByLabelText("Target weight (%)")).not.toBeInTheDocument();
      expect(screen.getByText("Price range for ASML")).toBeInTheDocument();
      fireEvent.change(low(), { target: { value: "90" } });
      fireEvent.change(high(), { target: { value: "110" } });

      fireEvent.click(screen.getByRole("button", { name: /save range/i }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(body()).toEqual({ ticker: "ASML", asset_type: "STOCK", target_price_low: 90, target_price_high: 110 });
    });

    it("with range only and nothing edited, just closes without a request", () => {
      const onClose = vi.fn();
      render(<WatchTargetDialog item={{ ...ITEM, target_price_low: 90, target_price_high: 110 }} rangeOnly onClose={onClose} onSaved={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: /save range/i }));

      expect(onClose).toHaveBeenCalled();
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it("says the prices are in the quote's own unit", () => {
      setup();
      expect(screen.getByText(/pence/i)).toBeInTheDocument();
    });
  });

  it("rejects values outside 0 to 100 without a request", () => {
    setup();
    fireEvent.change(field(), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: /save target/i }));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getAllByText(/0 to 100/).length).toBeGreaterThan(0);
  });
});
