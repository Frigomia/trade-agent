import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecurringData } from "@/lib/api/recurring-types";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiFetch, ApiError: class extends Error {} }));
vi.mock("./PortfolioTabs", () => ({ PortfolioTabs: () => null }));
vi.mock("@/components/shell/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));

import { RecurringInvestments } from "./RecurringInvestments";

const data: RecurringData = {
  plans: [{ id: 1, name: "Employer stock plan", ticker: "SAP.DE", asset_type: "STOCK", source: "Employer", amount: 400,
    currency: "EUR", frequency: "monthly", start_date: "2026-01-31", next_date: "2026-04-30", status: "active",
    upcoming_dates: ["2026-04-30", "2026-05-31", "2026-06-30"] }],
  occurrences: [{ id: 7, plan_id: 1, scheduled_date: "2026-03-31", ticker: "SAP.DE", asset_type: "STOCK", amount: 400,
    currency: "EUR", status: "scheduled", trade_id: null }],
};

function setup() {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><RecurringInvestments /></SWRConfig>);
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes("/preview")) return { upcoming_dates: ["2026-04-30", "2026-05-31", "2026-06-30"], catch_up_count: 3 };
    if (!init) return structuredClone(data);
    return {};
  });
});

describe("Recurring investments", () => {
  it("previews before saving a €400 plan and invalidates the preview when edited", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add recurring investment" }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Trade Republic savings plan" } });
    fireEvent.change(screen.getByLabelText(/^Stock \/ ETF ticker/), { target: { value: "VWCE.DE" } });
    fireEvent.change(screen.getByLabelText(/^Expected amount/), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: "2026-01-31" } });
    expect(screen.getByText(/Entries are added automatically on the dates you set/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview dates" }));
    await screen.findByText(/3 unconfirmed entries will be added now/);
    expect(apiFetch.mock.calls.some(([, init]) => init?.method === "POST" && !String(init.body).includes("monthly"))).toBe(false);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "My Trade Republic plan" } });
    expect(screen.queryByRole("button", { name: "Save recurring investment" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview dates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save recurring investment" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/recurring", expect.objectContaining({ method: "POST" })));
    const call = apiFetch.mock.calls.find(([path, init]) => path === "/portfolio/recurring" && init?.method === "POST");
    expect(JSON.parse(call![1].body)).toMatchObject({ amount: 400, currency: "EUR", ticker: "VWCE.DE", name: "My Trade Republic plan", frequency: "monthly" });
  });

  it("shows expected entries and confirms through the trade sheet with actual details", async () => {
    setup();
    expect(await screen.findByText("Scheduled · Unconfirmed")).toBeInTheDocument();
    expect(screen.getByText(/Expected amounts are separate from confirmed holdings/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm actual purchase" }));
    expect(screen.getByLabelText("Ticker")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Sold" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Shares"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-03-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to log" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/recurring/occurrences/7/confirm", {
      method: "POST", body: JSON.stringify({ date: "2026-03-30", shares: 2.5, price: 100 }),
    }));
    expect(apiFetch.mock.calls.some(([path]) => path === "/portfolio/trades")).toBe(false);
  });

  it("pauses and skips using explicit local status changes", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/recurring/1/status", { method: "PATCH", body: '{"status":"paused"}' }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/recurring/occurrences/7", { method: "PATCH", body: '{"status":"skipped"}' }));
  });

  it("shows future-only edit rules and requires a separate confirmation to end", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByText(/Edits apply after today/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview dates" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/recurring/preview?editing=true", expect.objectContaining({ method: "POST" })));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "End plan" }));
    expect(screen.getByText(/permanently stops future entries/)).toBeInTheDocument();
    expect(apiFetch.mock.calls.some(([, init]) => init?.body === '{"status":"ended"}')).toBe(false);
  });
});
