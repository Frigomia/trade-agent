import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import type { DiscoverItem } from "@/lib/api/discover-types";

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

import { TargetDialog } from "./TargetDialog";
import { RANGE_ERROR } from "@/lib/priceRange";
import { TARGET_ERROR } from "@/lib/targetWeight";

const ITEM: DiscoverItem = {
  ticker: "ASML",
  asset_type: "STOCK",
  name: "ASML Holding",
  exchange: "AMS",
  currency: "EUR",
  source: "manual",
  added_at: "2026-10-20T08:00:00",
  note: null,
  target_weight: 0.072,
  target_price_low: null,
  target_price_high: null,
  price: 700,
  change_pct: 0.4,
  price_as_of: "2026-10-21",
  stale: false,
  status: "none",
  insight: null,
  report_id: null,
  owned: false,
};

function setup(item: DiscoverItem = ITEM) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const onStale = vi.fn();
  const view = render(<TargetDialog item={item} onClose={onClose} onSaved={onSaved} onStale={onStale} />);
  const show = (next: DiscoverItem | null) => view.rerender(<TargetDialog item={next} onClose={onClose} onSaved={onSaved} onStale={onStale} />);
  return { onSaved, onClose, onStale, show };
}
const call = () => apiFetch.mock.calls[0] as [string, RequestInit];
const body = () => JSON.parse(call()[1].body as string);
const field = () => screen.getByLabelText("Target weight (%)") as HTMLInputElement;
const low = () => screen.getByLabelText("Lowest price") as HTMLInputElement;
const high = () => screen.getByLabelText("Highest price") as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: /^save (target|range)$/i }));

describe("TargetDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue({});
  });

  it("shows the saved fraction as a percentage and saves an edit as a fraction, with a PATCH to the company", async () => {
    const { onSaved, onClose } = setup();
    expect(field().value).toBe("7.2");
    fireEvent.change(field(), { target: { value: "12.5" } });

    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(call()[0]).toBe("/discover/ASML");
    expect(call()[1].method).toBe("PATCH");
    expect(body()).toEqual({ target_weight: 0.125 });
  });

  it("sends only what was edited: a range alone never carries the weight", async () => {
    const { onSaved } = setup();
    fireEvent.change(low(), { target: { value: "90" } });
    fireEvent.change(high(), { target: { value: "110,5" } });

    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toEqual({ target_price_low: 90, target_price_high: 110.5 });
  });

  it("sends an explicit null when the weight is cleared", async () => {
    const { onSaved } = setup();
    fireEvent.change(field(), { target: { value: "" } });

    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toEqual({ target_weight: null });
  });

  it("clears a saved range with two explicit nulls", async () => {
    const { onSaved } = setup({ ...ITEM, target_price_low: 90, target_price_high: 110 });
    expect([low().value, high().value]).toEqual(["90", "110"]);
    fireEvent.change(low(), { target: { value: "" } });
    fireEvent.change(high(), { target: { value: "" } });

    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toEqual({ target_price_low: null, target_price_high: null });
  });

  it("just closes, with no request, when nothing was edited", () => {
    const { onClose } = setup({ ...ITEM, target_price_low: 90, target_price_high: 110 });

    save();

    expect(onClose).toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("does not check or send a range that was not touched, even one the form cannot read back", async () => {
    const { onSaved } = setup({ ...ITEM, target_price_low: 0.0000001, target_price_high: 5 });
    fireEvent.change(field(), { target: { value: "3" } });

    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toEqual({ target_weight: 0.03 });
  });

  it("refuses one end alone, or a lowest price above the highest, without a request", () => {
    setup();
    fireEvent.change(low(), { target: { value: "90" } });
    save();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getAllByText(/both ends of the range/i)).toHaveLength(1); // under the fields, not repeated in an alert

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

  it("rejects a weight outside 0 to 100 without a request", () => {
    setup();
    fireEvent.change(field(), { target: { value: "101" } });
    save();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getAllByText(/0 to 100/).length).toBeGreaterThan(0);
  });

  it("shows both problems at once: the weight in the alert and the range under its fields", () => {
    setup();
    fireEvent.change(field(), { target: { value: "101" } });
    fireEvent.change(low(), { target: { value: "5" } }); // one end alone
    save();

    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getAllByText(TARGET_ERROR).length).toBeGreaterThan(0);
    expect(screen.getByText(RANGE_ERROR)).toBeInTheDocument();
  });

  it("for an owned company, hides the weight, says where it is set, and sends only the range", async () => {
    const { onSaved } = setup({ ...ITEM, owned: true, target_weight: 0.3 });
    expect(screen.queryByLabelText("Target weight (%)")).not.toBeInTheDocument();
    expect(screen.getByText("Price range for ASML Holding")).toBeInTheDocument();
    expect(screen.getByText(/weight target is set on the holding/i)).toBeInTheDocument();
    fireEvent.change(low(), { target: { value: "90" } });
    fireEvent.change(high(), { target: { value: "110" } });

    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toEqual({ target_price_low: 90, target_price_high: 110 });
  });

  it("says the prices are in the card's currency, or that the currency is not known yet", () => {
    const { unmount } = render(<TargetDialog item={ITEM} onClose={vi.fn()} onSaved={vi.fn()} onStale={vi.fn()} />);
    expect(screen.getByText(/prices are in EUR, the same as the price on the card/i)).toBeInTheDocument();
    unmount();

    render(<TargetDialog item={{ ...ITEM, currency: null }} onClose={vi.fn()} onSaved={vi.fn()} onStale={vi.fn()} />);
    expect(screen.getByText(/currency is not known yet/i)).toBeInTheDocument();
  });

  it("shows the reason a save was refused and stays open for another try", async () => {
    apiFetch.mockRejectedValueOnce(new FakeApiError(503, "Its currency could not be read right now. Try again."));
    const { onSaved, onClose } = setup();
    fireEvent.change(low(), { target: { value: "90" } });
    fireEvent.change(high(), { target: { value: "110" } });

    save();

    expect(await screen.findByText("Its currency could not be read right now. Try again.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /save target/i })).toBeEnabled();
  });

  it("when the company was removed elsewhere (404), says so, reads the list again and does not offer the same save again", async () => {
    apiFetch.mockRejectedValueOnce(new FakeApiError(404, "Not in your Discover list"));
    const { onSaved, onClose, onStale } = setup();
    fireEvent.change(field(), { target: { value: "3" } });

    save();

    expect(await screen.findByText("Not in your Discover list")).toBeInTheDocument();
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /save target/i })).toBeDisabled();
  });

  it("keeps the dialog open with the reason after the refreshed list no longer has the company, until it is closed", async () => {
    apiFetch.mockRejectedValueOnce(new FakeApiError(404, "Not in your Discover list"));
    const { onClose, show } = setup();
    fireEvent.change(field(), { target: { value: "3" } });
    save();
    expect(await screen.findByText("Not in your Discover list")).toBeInTheDocument();

    show(null); // the list was read again and the company is not in it
    await new Promise((resolve) => setTimeout(resolve, 400)); // longer than the dialog's exit transition

    expect(screen.getByText("Not in your Discover list")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not reopen when a save is refused as gone after the dialog was left", async () => {
    let refuse: (reason: Error) => void = () => {};
    apiFetch.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
    const { onStale, show } = setup();
    fireEvent.change(field(), { target: { value: "3" } });
    save();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); // left before the answer
    show(null);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    refuse(new FakeApiError(404, "Not in your Discover list"));
    await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("starts a fresh form when the same company is reopened while the last one is still fading out", () => {
    const { show } = setup();
    fireEvent.change(field(), { target: { value: "9" } });
    show(null);

    show(ITEM);

    expect(field().value).toBe("7.2");
  });

  it("does not blank the dialog while it fades out", () => {
    const { show } = setup();

    show(null);

    expect(screen.getByText("Target for ASML Holding")).toBeInTheDocument();
  });

  it("says so when the company changed elsewhere meanwhile, and keeps the untouched fields as opened", () => {
    const { show } = setup();
    expect(screen.queryByText(/changed elsewhere/i)).not.toBeInTheDocument();

    show({ ...ITEM, target_weight: 0.1 });

    expect(screen.getByText(/changed elsewhere while you were editing/i)).toBeInTheDocument();
    expect(field().value).toBe("7.2"); // what it held when it opened
  });

  it("reads the list again, keeping the reason, when the company turned out to be owned (409)", async () => {
    apiFetch.mockRejectedValueOnce(new FakeApiError(409, "You own this company: set its target on the holding."));
    const { onSaved, onStale } = setup();
    fireEvent.change(field(), { target: { value: "3" } });

    save();

    expect(await screen.findByText("You own this company: set its target on the holding.")).toBeInTheDocument();
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /save target/i })).toBeEnabled();
  });

  it("refreshes only what the edit touches: the insights for a range, the summary for a weight", async () => {
    const insights = vi.fn().mockResolvedValue({ insights: [], missing: [] });
    const summary = vi.fn().mockResolvedValue({});
    function Probe() {
      useSWR("/portfolio/insights", insights);
      useSWR("/portfolio/summary", summary);
      return null;
    }
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Probe />
        <TargetDialog item={ITEM} onClose={vi.fn()} onSaved={vi.fn()} onStale={vi.fn()} />
      </SWRConfig>,
    );
    await waitFor(() => expect(insights).toHaveBeenCalledTimes(1));
    fireEvent.change(field(), { target: { value: "3" } });

    save();

    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2));
    expect(insights).toHaveBeenCalledTimes(1); // the range was not edited
  });

  it("lets a range that is already saved be cleared even while the currency is unknown", async () => {
    const { onSaved } = setup({ ...ITEM, currency: null, target_price_low: 90, target_price_high: 110 });
    fireEvent.change(low(), { target: { value: "" } });
    fireEvent.change(high(), { target: { value: "" } });

    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toEqual({ target_price_low: null, target_price_high: null });
  });

  it("does not send a field the person never touched when the list refreshes it meanwhile", async () => {
    const onSaved = vi.fn();
    const props = { onClose: vi.fn(), onSaved, onStale: vi.fn() };
    const { rerender } = render(<TargetDialog item={ITEM} {...props} />);
    fireEvent.change(low(), { target: { value: "90" } });
    fireEvent.change(high(), { target: { value: "110" } });

    // Another tab changed the weight; the list refresh hands the dialog the newer company.
    rerender(<TargetDialog item={{ ...ITEM, target_weight: 0.125 }} {...props} />);
    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toEqual({ target_price_low: 90, target_price_high: 110 }); // no stale weight
  });

  it("and the other way: a refreshed range is not sent with an edited weight", async () => {
    const onSaved = vi.fn();
    const props = { onClose: vi.fn(), onSaved, onStale: vi.fn() };
    const { rerender } = render(<TargetDialog item={{ ...ITEM, target_price_low: 90, target_price_high: 110 }} {...props} />);
    fireEvent.change(field(), { target: { value: "3" } });

    rerender(<TargetDialog item={{ ...ITEM, target_price_low: 95, target_price_high: 120 }} {...props} />);
    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toEqual({ target_weight: 0.03 }); // no stale range
  });

  it("hands the backend's answer to onSaved, so the card can show it without reading the whole list", async () => {
    const answer = { ...ITEM, target_weight: 0.125 };
    apiFetch.mockResolvedValueOnce(answer);
    const { onSaved } = setup();
    fireEvent.change(field(), { target: { value: "12.5" } });

    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(answer));
  });

  it("does not close a dialog opened later when a save finishes after this one was left", async () => {
    let finish: (value: unknown) => void = () => {};
    apiFetch.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const { rerender } = render(<TargetDialog item={ITEM} onClose={onClose} onSaved={onSaved} onStale={vi.fn()} />);
    fireEvent.change(field(), { target: { value: "3" } });
    save();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());

    rerender(<TargetDialog item={null} onClose={onClose} onSaved={onSaved} onStale={vi.fn()} />); // Esc: left
    finish({ ...ITEM, target_weight: 0.03 });

    await waitFor(() => expect(onSaved).toHaveBeenCalled()); // the list still learns of the save
    expect(onClose).not.toHaveBeenCalled(); // but nothing is closed under the person
  });

  it("with no known currency, does not take a range (the fields are off) but still saves the weight", async () => {
    const { onSaved } = setup({ ...ITEM, currency: null });
    expect(low()).toBeDisabled();
    expect(high()).toBeDisabled();

    fireEvent.change(field(), { target: { value: "3" } });
    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body()).toEqual({ target_weight: 0.03 });
  });

  it("refreshes Today's insights once a range is saved, and not the Portfolio summary", async () => {
    const insights = vi.fn().mockResolvedValue({ insights: [], missing: [] });
    const summary = vi.fn().mockResolvedValue({});
    function Probe() {
      useSWR("/portfolio/insights", insights);
      useSWR("/portfolio/summary", summary);
      return null;
    }
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Probe />
        <TargetDialog item={ITEM} onClose={vi.fn()} onSaved={vi.fn()} onStale={vi.fn()} />
      </SWRConfig>,
    );
    await waitFor(() => expect(insights).toHaveBeenCalledTimes(1));
    fireEvent.change(low(), { target: { value: "90" } });
    fireEvent.change(high(), { target: { value: "110" } });

    save();

    await waitFor(() => expect(insights).toHaveBeenCalledTimes(2));
    expect(summary).toHaveBeenCalledTimes(1); // the weight was not edited
  });
});
