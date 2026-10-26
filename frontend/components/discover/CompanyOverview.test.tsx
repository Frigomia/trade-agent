import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { CompanyOverviewData } from "@/lib/api/discover-types";

const { apiFetch, FakeApiError } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  FakeApiError: class extends Error { constructor(public status: number) { super("Unavailable"); } },
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args), ApiError: FakeApiError }));
import { CompanyOverview } from "./CompanyOverview";

const data: CompanyOverviewData = {
  company: {
    ticker: "HLDN", name: "Halden Systems", asset_type: "STOCK", exchange: "NASDAQ", currency: "USD",
    source: "manual", added_at: null, note: null, target_weight: null, target_price_low: null, target_price_high: null,
    price: 184.2, change_pct: 1, price_as_of: "2026-10-23", stale: false, status: "none", insight: null, report_id: null, owned: false,
  },
  sector: "Technology", industry: "Software", country: "United States", missing: [],
};
function show(value = data, historyFails = false) {
  apiFetch.mockImplementation((path: string) => {
    if (path.endsWith("/overview")) return Promise.resolve(value);
    if (historyFails) return Promise.reject(new Error("Provider unavailable"));
    return Promise.resolve({ ticker: "HLDN", currency: "USD", range: "1m", as_of: "2026-10-23", points: [{ date: "2026-10-22", close: 180 }, { date: "2026-10-23", close: 184.2 }] });
  });
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><CompanyOverview ticker="HLDN" /></SWRConfig>);
}
beforeEach(() => { apiFetch.mockReset(); });

describe("CompanyOverview", () => {
  it("shows provider facts and the reusable keyboard-readable chart without starting research", async () => {
    show();
    expect(await screen.findByRole("heading", { name: "Halden Systems" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /Price chart/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("As of 2026-10-23")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Company facts" })).toHaveTextContent("Technology");
    expect(screen.queryByRole("tablist", { name: "Company sections" })).not.toBeInTheDocument();
    for (const [, options] of apiFetch.mock.calls) expect(options?.method).not.toBe("POST");
  });
  it("keeps the overview usable if price history fails and shows no invented chart", async () => {
    show(data, true);
    expect(await screen.findByText("Price history is unavailable. No values have been guessed.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Halden Systems" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Price chart/ })).not.toBeInTheDocument();
  });
  it("opens only an actual saved report", async () => {
    show({ ...data, company: { ...data.company, report_id: 42, status: "analyzed" } });
    expect(await screen.findByRole("link", { name: "View report" })).toHaveAttribute("href", "/today/42");
  });
  it("does not claim a refund before settlement is confirmed", async () => {
    show({ ...data, company: { ...data.company, analysis: {
      job_id: "job", created_at: "2026-10-26", finished_at: "2026-10-26", status: "failed",
      researched: false, reason: "Research could not finish.", report_id: null,
      charge_state: "pending", can_analyze: false,
    } } });
    expect(await screen.findByText("Usage settlement is pending. Wait for confirmation before retrying.")).toBeInTheDocument();
    expect(screen.queryByText("No monthly run is charged for this attempt.")).not.toBeInTheDocument();
  });
  it("does not load company history for an unknown or other user's ticker", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(404));
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><CompanyOverview ticker="PRIVATE" /></SWRConfig>);
    expect(await screen.findByText("This company is no longer in your Discover list.")).toBeInTheDocument();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });
});
