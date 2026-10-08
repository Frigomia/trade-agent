import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
      placed_shares: null,
      placed_price: null,
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
    const orders = screen.getByRole("list", { name: "Orders" });
    expect(within(orders).getByText("487.50 EUR")).toBeInTheDocument();
    expect(within(orders).getByText("7 sh")).toBeInTheDocument();
    expect(screen.getByText("Leftover 12.50 EUR")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 placed")).toBeInTheDocument();

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

  it("reloads the opened plan after an ISIN is saved, so the ticket carries it", async () => {
    let isin: string | null = null;
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/portfolio/instruments/KO/isin") {
        isin = (JSON.parse(init!.body as string) as { isin: string }).isin;
        return Promise.resolve({ ticker: "KO", isin });
      }
      if (path === "/plans/5" && !init) return Promise.resolve({ ...SEPTEMBER, lines: SEPTEMBER.lines.map((l) => ({ ...l, isin })) });
      return base(path, init);
    });
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: "Open the September 2026 plan" }));
    fireEvent.click(await screen.findByRole("button", { name: /^KO, 487.50 EUR, not placed, press to open$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add ISIN" }));
    fireEvent.change(screen.getByLabelText("ISIN for KO"), { target: { value: "us1912161007" } });
    fireEvent.click(screen.getByRole("button", { name: "Save ISIN" }));
    expect(await screen.findByText(/ISIN US1912161007 · 7 shares at 69.64 EUR/)).toBeInTheDocument();
    expect(screen.getByText("ISIN saved")).toBeInTheDocument();
  });

  it("records a placed order through the shared sheet and reloads the plan", async () => {
    let placed = false;
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/portfolio/summary") return Promise.resolve({ holdings: [], watchlist: [] });
      if (path === "/plans/5/lines/11/placed") {
        placed = true;
        return Promise.resolve({});
      }
      if (path === "/plans/5" && !init) {
        const l = { ...SEPTEMBER.lines[0], id: 11 };
        return Promise.resolve({ ...SEPTEMBER, lines: [placed ? { ...l, placed_at: "2026-10-08T10:00:00", placed_shares: 7, placed_price: 75.1 } : l] });
      }
      return base(path, init);
    });
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: "Open the September 2026 plan" }));
    fireEvent.click(await screen.findByRole("button", { name: /^KO, 487.50 EUR, not placed, press to open$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Placed" }));
    const sheet = await screen.findByRole("dialog", { name: "Record placed order" });
    fireEvent.change(within(sheet).getByLabelText("Price per share"), { target: { value: "75.10" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Record order" }));
    expect(await screen.findByText("KO recorded as placed. All lines placed.")).toBeInTheDocument();
    const [, init] = apiFetch.mock.calls.find(([p]) => p === "/plans/5/lines/11/placed")!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ shares: 7, price: 75.1, asset_type: "ETF" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Placed 8 Oct · 7 sh at 75.10")).toBeInTheDocument();
  });

  describe("late answers after another plan was opened", () => {
    const OCTOBER: Plan = { ...SEPTEMBER, id: 9, created_at: "2026-10-15T12:00:00", lines: [{ ...SEPTEMBER.lines[0], id: 21, ticker: "PEP", name: "PepsiCo" }] };
    let placedAnswer: (v: unknown) => void;
    let reloadAnswer: ((v: unknown) => void) | null;
    let reloads: number;

    beforeEach(() => {
      reloadAnswer = null;
      reloads = 0;
      let firstLoad = true;
      const base = apiFetch.getMockImplementation()!;
      apiFetch.mockImplementation((path: string, init?: RequestInit) => {
        if (path === "/portfolio/summary") return Promise.resolve({ holdings: [], watchlist: [] });
        if (path === "/plans/5/lines/11/placed") return new Promise((r) => (placedAnswer = r));
        if (path === "/plans/9" && !init) return Promise.resolve(OCTOBER);
        if (path === "/plans/5" && !init) {
          const plan = { ...SEPTEMBER, lines: [{ ...SEPTEMBER.lines[0], id: 11 }] };
          if (firstLoad) {
            firstLoad = false;
            return Promise.resolve(plan);
          }
          reloads += 1;
          return new Promise((r) => (reloadAnswer = () => r({ ...plan, lines: [{ ...plan.lines[0], placed_at: "2026-10-08T10:00:00" }] })));
        }
        return base(path, init);
      });
    });

    async function recordKo() {
      renderFresh();
      fireEvent.click(await screen.findByRole("button", { name: "Open the September 2026 plan" }));
      fireEvent.click(await screen.findByRole("button", { name: /^KO, 487.50 EUR, not placed, press to open$/ }));
      fireEvent.click(screen.getByRole("button", { name: "Placed" }));
      const sheet = await screen.findByRole("dialog", { name: "Record placed order" });
      fireEvent.change(within(sheet).getByLabelText("Price per share"), { target: { value: "75.10" } });
      fireEvent.click(within(sheet).getByRole("button", { name: "Record order" }));
      await waitFor(() => expect(apiFetch.mock.calls.some(([p]) => p === "/plans/5/lines/11/placed")).toBe(true));
    }

    it("keeps the other plan when the record answer lands after it was opened", async () => {
      await recordKo();
      fireEvent.click(screen.getByRole("button", { name: "Open the October 2026 plan", hidden: true }));
      expect(await screen.findByRole("heading", { name: "October 2026, as saved", hidden: true })).toBeInTheDocument();
      placedAnswer({});
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(reloads).toBe(0);
      expect(screen.getByRole("heading", { name: "October 2026, as saved" })).toBeInTheDocument();
      expect(screen.queryByText(/recorded as placed/)).not.toBeInTheDocument();
    });

    it("drops a plan reload that lands after another plan was opened", async () => {
      await recordKo();
      placedAnswer({});
      expect(await screen.findByText("KO recorded as placed. All lines placed.")).toBeInTheDocument();
      await waitFor(() => expect(reloads).toBe(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Open the October 2026 plan" }));
      expect(await screen.findByRole("heading", { name: "October 2026, as saved" })).toBeInTheDocument();
      reloadAnswer!(undefined);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(screen.getByRole("heading", { name: "October 2026, as saved" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "September 2026, as saved" })).not.toBeInTheDocument();
    });
  });

  it("says when nothing is saved yet", async () => {
    plans = [];
    renderFresh();
    expect(await screen.findByText(/No saved plans yet/)).toBeInTheDocument();
  });
});
