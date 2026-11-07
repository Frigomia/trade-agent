import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecurringData } from "@/lib/api/recurring-types";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiFetch, ApiError: class extends Error {} }));
vi.mock("@/components/ui/TickerPicker", () => ({
  TickerPicker: ({ value, onPick }: { value: string; onPick: (m: object) => void }) =>
    <button type="button" onClick={() => onPick({ symbol: "CNDX.L", name: "NASDAQ-100 UCITS ETF", type: "ETF", exchange: "LSE" })}>Choose ETF {value}</button>,
}));
import { HoldingForm } from "./HoldingForm";
import { TradeSheet } from "./TradeSheet";
import { RecurringInvestments, RecurringPlanForm } from "./RecurringInvestments";

const data: RecurringData = {
  plans: [{ id: 1, name: "SAP SE", ticker: "SAP.DE", asset_type: "STOCK", amount: "400.00",
    currency: "EUR", frequency: "monthly", start_date: "2026-01-31", next_date: "2026-12-31",
    status: "active", tracking_enabled: true, upcoming_dates: ["2026-12-31"] }],
  occurrences: [{ id: 7, plan_id: 1, scheduled_date: "2026-10-31", ticker: "SAP.DE",
    asset_type: "STOCK", amount: "400.00", currency: "EUR", status: "posted", trade_id: 2,
    shares: "4.000000", price: "100.000000", quote_currency: "EUR", trade_date: "2026-11-02" }],
};
function wrap(child: React.ReactNode) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{child}</SWRConfig>);
}
beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes("/preview")) return { upcoming_dates: ["2027-01-15"], catch_up_count: 0 };
    if (!init) return structuredClone(data);
    return {};
  });
});
afterEach(() => vi.useRealTimers());

describe("Integrated recurring estimates", () => {
  it("creates an ETF plan from Add Holding through the shared search without making a holding", async () => {
    const onSaved = vi.fn();
    wrap(<HoldingForm open onClose={vi.fn()} heldTickers={[]} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Recurring" }));
    fireEvent.click(screen.getByRole("button", { name: /Choose ETF/ }));
    fireEvent.change(screen.getByLabelText(/^Contribution amount/), { target: { value: "300.00" } });
    fireEvent.change(screen.getByLabelText(/^Start \/ anchor date/), { target: { value: "2027-01-15" } });
    expect(screen.queryByLabelText(/Shares/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Broker|Source|Employer/)).not.toBeInTheDocument();
    expect(screen.getByText(/Purchases are estimated from market prices/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview schedule" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save recurring plan" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const save = apiFetch.mock.calls.find(([path, init]) => path === "/portfolio/recurring" && init?.method === "POST");
    expect(JSON.parse(save![1].body)).toMatchObject({ ticker: "CNDX.L", asset_type: "ETF", amount: "300.00", currency: "EUR", backfill: false });
    expect(apiFetch.mock.calls.some(([path]) => path === "/portfolio/holdings")).toBe(false);
  });

  it("preselects the instrument from Log Trade and leaves One-time available", () => {
    wrap(<TradeSheet open onClose={vi.fn()} onLogged={vi.fn()} holdings={[{ ticker: "SAP.DE", name: "SAP SE", asset_type: "STOCK" }]} prefill={{ ticker: "SAP.DE" }} />);
    expect(screen.getByRole("button", { name: "Bought" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recurring" }));
    expect(screen.getByRole("button", { name: /Choose ETF SAP.DE/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sold" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "One-time" }));
    expect(screen.getByRole("button", { name: "Sold" })).toBeInTheDocument();
  });

  it("requires explicit backfill approval and invalidates an edited preview", async () => {
    apiFetch.mockImplementation(async (path: string) => path.includes("/preview")
      ? { upcoming_dates: ["2027-01-15"], catch_up_count: 3, first_date: "2026-01-15", last_date: "2026-03-15" } : {});
    wrap(<HoldingForm open onClose={vi.fn()} heldTickers={[]} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Recurring" }));
    fireEvent.click(screen.getByRole("button", { name: /Choose ETF/ }));
    fireEvent.change(screen.getByLabelText(/^Contribution amount/), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText(/^Start \/ anchor date/), { target: { value: "2026-01-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview schedule" }));
    await screen.findByLabelText("Add these historical estimates to my portfolio");
    fireEvent.click(screen.getByRole("button", { name: "Save recurring plan" }));
    expect(apiFetch.mock.calls.some(([path]) => path === "/portfolio/recurring")).toBe(false);
    fireEvent.change(screen.getByLabelText(/^Contribution amount/), { target: { value: "350" } });
    expect(screen.getByRole("button", { name: "Preview schedule" })).toBeInTheDocument();
  });

  it("manages unheld plans, labels estimated history, pauses and corrects through local APIs", async () => {
    wrap(<RecurringInvestments />);
    fireEvent.click(screen.getByRole("button", { name: "Manage recurring plans" }));
    await screen.findByText("SAP SE · SAP.DE");
    expect(screen.getByText(/Estimated purchase · Plan #1/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm actual purchase/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/recurring/1/status", { method: "PATCH", body: '{"status":"paused"}' }));
    fireEvent.click(screen.getByRole("button", { name: "Correct estimate" }));
    fireEvent.change(screen.getByLabelText(/^Shares/), { target: { value: "3.9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save actual details" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/recurring/occurrences/7/estimate",
      expect.objectContaining({ method: "PUT" })));
  });

  it("shows legacy settings without enabling tracking silently", async () => {
    apiFetch.mockResolvedValue({ ...data, plans: [{ ...data.plans[0], tracking_enabled: false }] });
    wrap(<RecurringInvestments />);
    fireEvent.click(screen.getByRole("button", { name: "Manage recurring plans" }));
    await screen.findByText(/Saved legacy plan/);
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("records an actual purchase for a legacy pending entry", async () => {
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => init ? {} : {
      plans: [{ ...data.plans[0], tracking_enabled: false }],
      occurrences: [{ ...data.occurrences[0], status: "scheduled", trade_id: null, shares: null, price: null }],
    });
    wrap(<RecurringInvestments />);
    fireEvent.click(screen.getByRole("button", { name: "Manage recurring plans" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record actual purchase" }));
    expect(screen.queryByRole("button", { name: "Void estimate" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Shares/), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/^Price/), { target: { value: "125" } });
    fireEvent.click(screen.getByRole("button", { name: "Save actual details" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/recurring/occurrences/7/confirm",
      expect.objectContaining({ method: "POST" })));
  });

  it("uses Berlin for the default date and the server preview for historical approval", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-06T22:30:00Z"));
    apiFetch.mockResolvedValue({ upcoming_dates: ["2026-08-06"], catch_up_count: 1,
      first_date: "2026-07-06", last_date: "2026-07-06" });
    wrap(<RecurringPlanForm prefill={{ ticker: "SAP.DE" }} onSaved={vi.fn()} onClose={vi.fn()} onBusyChange={vi.fn()} />);
    expect(screen.getByLabelText(/^Start \/ anchor date/)).toHaveValue("2026-07-07");
    fireEvent.change(screen.getByLabelText(/^Start \/ anchor date/), { target: { value: "2026-07-06" } });
    fireEvent.change(screen.getByLabelText(/^Contribution amount/), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview schedule" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save recurring plan" }));
    expect(screen.getByLabelText("Add these historical estimates to my portfolio")).toBeInTheDocument();
    await screen.findByText("Approve the previewed historical estimates before saving.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save recurring plan" })).toBeEnabled());
    expect(apiFetch.mock.calls.some(([path]) => path === "/portfolio/recurring")).toBe(false);
    fireEvent.click(screen.getByLabelText("Add these historical estimates to my portfolio"));
    fireEvent.click(screen.getByRole("button", { name: "Save recurring plan" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/recurring",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"backfill":true') })));
  });
});
