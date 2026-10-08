import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { Plan, PlanSummary } from "@/lib/plans";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class extends Error {},
}));

import { PlanHistory } from "./PlanHistory";

const SEPTEMBER: Plan = {
  id: 5,
  created_at: "2026-09-15T12:00:00",
  amount_eur: 500,
  whole_shares: true,
  total_before_eur: 7000,
  leftover_eur: 12.5,
  lines: [
    {
      id: null,
      isin: null,
      placed_at: null,
      placed_trade_id: null,
      ticker: "KO",
      name: "Coca-Cola",
      amount_eur: 487.5,
      shares: 7,
      price_eur: 69.64,
      currency: "USD",
      rate: 0.91,
      weight_before: 0.07,
      weight_after: 0.12,
      reason: "underweight",
      reason_text: "Below its target weight",
    },
  ],
  notes: [],
  disclaimer: "Advisory only. Nothing is sent to a broker.",
};
let plans: PlanSummary[];

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PlanHistory />
    </SWRConfig>,
  );
}

describe("PlanHistory", () => {
  beforeEach(() => {
    plans = [
      { id: 3, created_at: "2026-08-15T12:00:00", amount_eur: 450, line_count: 2 },
      { id: 9, created_at: "2026-10-15T12:00:00", amount_eur: 500, line_count: 3 },
      { id: 5, created_at: "2026-09-15T12:00:00", amount_eur: 500, line_count: 1 },
    ];
    apiFetch.mockReset();
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/plans") return Promise.resolve(plans);
      if (path === "/plans/5" && init?.method === "DELETE") {
        plans = plans.filter((p) => p.id !== 5);
        return Promise.resolve(undefined);
      }
      if (path === "/plans/5") return Promise.resolve(SEPTEMBER);
      return Promise.reject(new Error(path));
    });
  });

  it("lists saved plans newest first", async () => {
    renderFresh();
    const table = await screen.findByRole("table", { name: "Saved plans" });
    const months = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(months).toEqual(["October 2026", "September 2026", "August 2026"]);
  });

  it("opens a plan as saved and deletes it only after the confirmation", async () => {
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: "Open the September 2026 plan" }));
    expect(await screen.findByRole("heading", { name: "September 2026, as saved" })).toBeInTheDocument();
    expect(screen.getByText("Add 487.50 EUR")).toBeInTheDocument();
    expect(screen.getByText("7 sh")).toBeInTheDocument();
    expect(screen.getByText("Leftover 12.50 EUR")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete plan" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete the September 2026 plan?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/plans/5", { method: "DELETE" });

    fireEvent.click(screen.getByRole("button", { name: "Delete plan" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete plan" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/plans/5", { method: "DELETE" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "September 2026, as saved" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open the September 2026 plan" })).not.toBeInTheDocument());
  });

  it("says when nothing is saved yet", async () => {
    plans = [];
    renderFresh();
    expect(await screen.findByText(/No saved plans yet/)).toBeInTheDocument();
  });
});
