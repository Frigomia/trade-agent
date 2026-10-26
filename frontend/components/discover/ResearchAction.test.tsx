import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { CompanyAnalysisState, DiscoverItem } from "@/lib/api/discover-types";

const { apiFetch, FakeApiError } = vi.hoisted(() => ({ apiFetch: vi.fn(), FakeApiError: class extends Error { constructor(public status: number, public detail: string) { super(detail); } } }));
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args), ApiError: FakeApiError }));
import { ResearchAction } from "./ResearchAction";

const item: DiscoverItem = { ticker: "SAP.DE", name: "SAP", asset_type: "STOCK", exchange: "XETRA", currency: "EUR", source: "manual", added_at: null, note: null, target_weight: null, target_price_low: null, target_price_high: null, price: 100, change_pct: 0, price_as_of: null, stale: true, status: "none", insight: null, report_id: null, owned: false };
const state = (over: Partial<CompanyAnalysisState> = {}): CompanyAnalysisState => ({ job_id: "job", created_at: "2026-10-26", finished_at: null, status: "running", researched: false, reason: "Researching sources.", report_id: null, charge_state: "reserved", can_analyze: false, ...over });
function show(over: Partial<DiscoverItem> = {}, used = 23, needsAttention = false) {
  apiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (options?.method === "POST") return Promise.resolve(state());
    if (path === "/me/usage") return Promise.resolve({ analysis_runs: { used, limit: 100 } });
    return Promise.resolve({ connected: true, needs_attention: needsAttention });
  });
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><ResearchAction item={{ ...item, ...over }} details /></SWRConfig>);
}
beforeEach(() => { apiFetch.mockReset(); });

describe("ResearchAction", () => {
  it("reads actual allowance and starts only after a deliberate click", async () => {
    show();
    expect(await screen.findByText(/23 of 100 monthly runs used/)).toHaveTextContent("77 remaining");
    expect(apiFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Analyze · 1 monthly run" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/discover/SAP.DE/analyze", { method: "POST" }));
  });
  it.each([
    [state(), "Analyzing"],
    [state({ status: "ineligible", charge_state: "none" }), "Waiting for eligible data"],
    [state({ status: "failed", charge_state: "pending" }), "Usage settlement pending"],
  ])("blocks another paid request for %s", async (analysis, text) => {
    show({ analysis });
    expect(await screen.findByRole("button", { name: new RegExp(text) })).toBeDisabled();
  });
  it("does not show a paid retry or cost line for a researched non-opportunity", () => {
    show({ analysis: state({ status: "no_opportunity", researched: true, charge_state: "charged" }) });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/monthly runs used/)).not.toBeInTheDocument();
  });
  it("blocks exhausted quota and links a rejected key to Account", async () => {
    show({}, 100);
    expect(await screen.findByRole("button", { name: "Monthly runs used up" })).toBeDisabled();
  });
  it("links a rejected key to the real Account route", async () => {
    show({}, 23, true);
    expect(await screen.findByRole("link", { name: "Reconnect Claude in Account" })).toHaveAttribute("href", "/more/account");
  });
});
