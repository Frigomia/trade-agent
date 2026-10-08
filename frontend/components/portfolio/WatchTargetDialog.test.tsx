import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("rejects values outside 0 to 100 without a request", () => {
    setup();
    fireEvent.change(field(), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: /save target/i }));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getAllByText(/0 to 100/).length).toBeGreaterThan(0);
  });
});
