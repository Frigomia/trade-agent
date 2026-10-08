import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import type { Plan, PlanLine } from "@/lib/plans";

const { apiFetch, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      public status: number,
      public detail: string,
    ) {
      super(detail);
    }
  }
  return { apiFetch: vi.fn(), FakeApiError };
});
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args), ApiError: FakeApiError }));
vi.mock("@/lib/format", async (orig) => ({ ...(await orig<typeof import("@/lib/format")>()), todayIso: () => "2026-10-08" }));

import { OrdersSection } from "./OrdersSection";

const line = (o: Partial<PlanLine>): PlanLine => ({
  id: 1,
  isin: "IE00BKM4GZ66",
  placed_at: null,
  placed_trade_id: null,
  placed_shares: null,
  placed_price: null,
  ticker: "EIMI.L",
  name: "iShares Core MSCI EM IMI UCITS ETF USD (Acc)",
  amount_eur: 92.3,
  shares: 1.69,
  price_eur: 54.64,
  currency: "USD",
  rate: 0.92,
  weight_before: 0.179,
  weight_after: 0.184,
  reason: "underweight",
  reason_text: "Below its target weight",
  ...o,
});
const LINES = [
  line({}),
  line({ id: 2, ticker: "IWDA.L", name: "iShares Core MSCI World", isin: "IE00B4L5Y983", amount_eur: 407.7, shares: 2.772, price_eur: 147.07 }),
  line({ id: 3, ticker: "NVDA", name: "NVIDIA Corporation", isin: null, amount_eur: 100, shares: 0.86, price_eur: 116.31 }),
];
const plan = (lines: PlanLine[] = LINES): Plan => ({
  id: 9,
  created_at: "2026-10-08T09:14:00",
  amount_eur: 600,
  whole_shares: false,
  total_before_eur: 7710,
  leftover_eur: 0,
  lines,
  notes: [],
  disclaimer: "Advisory only. Nothing is sent to a broker.",
});
const holding = (ticker: string, shares: number) => ({
  ticker,
  name: ticker,
  asset_type: "ETF",
  shares,
  cost_basis: 10,
  first_purchase_date: "2024-01-01",
  sector: null,
  target_weight: 0.3,
  current_price: null,
  market_value: null,
  unrealized_pl: null,
  unrealized_pl_pct: null,
  weight: null,
});
// IWDA.L is a closed holding (0 shares): still a holding row, so not new, as the backend sees it.
const SUMMARY = {
  holdings: [holding("EIMI.L", 3), holding("IWDA.L", 0)],
  watchlist: [{ ticker: "NVDA", asset_type: "STOCK", note: null, target_weight: 0.05, current_price: null }],
} as unknown as PortfolioSummary;

let place: (path: string, body: unknown) => Promise<unknown>;
const onChanged = vi.fn();

beforeEach(() => {
  apiFetch.mockReset();
  onChanged.mockReset().mockResolvedValue(undefined);
  place = (path) => Promise.resolve(line({ id: Number(path.split("/")[4]), placed_at: "2026-10-08T10:00:00" }));
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/portfolio/summary") return Promise.resolve(SUMMARY);
    if (path.endsWith("/placed")) return place(path, JSON.parse(init!.body as string));
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

function renderSection(p: Plan = plan()) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdersSection plan={p} onChanged={onChanged} />
    </SWRConfig>,
  );
}

const card = (ticker: string) => screen.getByRole("button", { name: new RegExp(`^${ticker.replace(".", "\\.")}, `) });
const placeCalls = () => apiFetch.mock.calls.filter(([p]) => String(p).endsWith("/placed"));
const sentBody = (i = 0) => JSON.parse((placeCalls()[i][1] as RequestInit).body as string);

/** The summary has been requested and its answer has landed, so held/new is known. */
async function summaryLoaded() {
  await waitFor(() => expect(apiFetch.mock.calls.some(([p]) => p === "/portfolio/summary")).toBe(true));
  await act(() => new Promise((r) => setTimeout(r, 0)));
}

/** Opens the line's card and its sheet; waits for the summary so held/new is known. */
async function openSheet(ticker: string) {
  renderSection();
  await summaryLoaded();
  fireEvent.click(card(ticker));
  const placedButton = screen.getByRole("button", { name: "Placed" });
  placedButton.focus(); // a real click focuses the button; fireEvent.click does not
  fireEvent.click(placedButton);
  const sheet = await screen.findByRole("dialog", { name: "Record placed order" });
  return { sheet, placedButton };
}
const record = (sheet: HTMLElement) => within(sheet).getByRole("button", { name: "Record order" });
const typePrice = (sheet: HTMLElement, value: string) =>
  fireEvent.change(within(sheet).getByLabelText("Price per share"), { target: { value } });

describe("Record placed order", () => {
  it("opens from Placed with the ticker fixed, shares prefilled, the price empty and the date today", async () => {
    const { sheet } = await openSheet("EIMI.L");
    expect(within(sheet).getByText("EIMI.L")).toBeInTheDocument();
    expect(within(sheet).getByText("iShares Core MSCI EM IMI UCITS ETF USD (Acc)")).toBeInTheDocument();
    expect(within(sheet).queryByRole("textbox", { name: /ticker/i })).not.toBeInTheDocument();
    expect(within(sheet).getByLabelText("Shares")).toHaveValue("1.69");
    expect(within(sheet).getByText(/about 1\.69 shares/)).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Price per share")).toHaveValue("");
    expect(within(sheet).getByText("Price in the currency of this holding")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Date")).toHaveValue("2026-10-08");
    expect(within(sheet).getByText("This only records the order here. Nothing is sent to a broker.")).toBeInTheDocument();
    // The plan's EUR price is nowhere in the sheet.
    expect(sheet.textContent).not.toContain("54.64");
    expect(sheet.textContent).not.toMatch(/\b(Buy|Sell|Deposit|Withdraw)\b/i);
    expect(record(sheet)).toBeDisabled();
  });

  it("moves the focus into the sheet, and back to Placed on Cancel", async () => {
    const { sheet, placedButton } = await openSheet("EIMI.L");
    await waitFor(() => expect(sheet).toContainElement(document.activeElement as HTMLElement));
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(placedButton).toHaveFocus());
    expect(placeCalls()).toHaveLength(0);
  });

  it("does not ask for an asset type for a holding, a closed one included, and does not send one", async () => {
    const { sheet } = await openSheet("IWDA.L");
    expect(within(sheet).queryByText("Asset type")).not.toBeInTheDocument();
    typePrice(sheet, "147.2");
    fireEvent.click(record(sheet));
    await waitFor(() => expect(placeCalls()).toHaveLength(1));
    expect(placeCalls()[0][0]).toBe("/plans/9/lines/2/placed");
    expect(sentBody()).toEqual({ date: "2026-10-08", shares: 2.772, price: 147.2 });
  });

  it("asks for the asset type of a new position, prefilled from the watchlist, and sends it", async () => {
    const { sheet } = await openSheet("NVDA");
    expect(within(sheet).getByText(/NVDA is not a holding yet\..*Prefilled from your watchlist\./)).toBeInTheDocument();
    const group = within(sheet).getByRole("group", { name: "Asset type" });
    expect(within(group).getByRole("button", { name: "Stock" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "ETF" })).toHaveAttribute("aria-pressed", "false");
    typePrice(sheet, "116,40");
    fireEvent.click(record(sheet));
    await waitFor(() => expect(placeCalls()).toHaveLength(1));
    expect(sentBody()).toEqual({ date: "2026-10-08", shares: 0.86, price: 116.4, asset_type: "STOCK" });
  });

  it("defaults the asset type of a new position not on the watchlist to ETF", async () => {
    renderSection(plan([line({ id: 4, ticker: "VWCE.DE", name: "Vanguard FTSE All-World" })]));
    await summaryLoaded();
    fireEvent.click(card("VWCE.DE"));
    fireEvent.click(screen.getByRole("button", { name: "Placed" }));
    const sheet = await screen.findByRole("dialog", { name: "Record placed order" });
    expect(within(sheet).getByRole("button", { name: "ETF" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).queryByText(/Prefilled from your watchlist/)).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Stock" }));
    typePrice(sheet, "120");
    fireEvent.click(record(sheet));
    await waitFor(() => expect(placeCalls()).toHaveLength(1));
    expect(sentBody().asset_type).toBe("STOCK");
  });

  it("keeps Record order disabled until shares and price are numbers above zero", async () => {
    const { sheet } = await openSheet("EIMI.L");
    const shares = within(sheet).getByLabelText("Shares");
    for (const bad of ["", "0", "-1", "1e5", "e", "abc", "Infinity"]) {
      typePrice(sheet, bad);
      expect(record(sheet)).toBeDisabled();
    }
    typePrice(sheet, "54.6");
    expect(record(sheet)).toBeEnabled();
    for (const bad of ["", "0", "-2", "1e5", "NaN"]) {
      fireEvent.change(shares, { target: { value: bad } });
      expect(record(sheet)).toBeDisabled();
    }
    expect(within(sheet).getByText("Enter a number of shares above 0.")).toBeInTheDocument();
    fireEvent.change(shares, { target: { value: "1,7" } });
    expect(record(sheet)).toBeEnabled();
    fireEvent.click(record(sheet));
    await waitFor(() => expect(placeCalls()).toHaveLength(1));
    expect(sentBody()).toEqual({ date: "2026-10-08", shares: 1.7, price: 54.6 });
  });

  it("sends one request on a double click", async () => {
    let resolve: (v: unknown) => void = () => {};
    place = () => new Promise((r) => (resolve = r));
    const { sheet } = await openSheet("EIMI.L");
    typePrice(sheet, "54.6");
    fireEvent.click(record(sheet));
    fireEvent.click(record(sheet));
    fireEvent.submit(record(sheet).closest("form")!);
    await waitFor(() => expect(record(sheet)).toBeDisabled());
    expect(placeCalls()).toHaveLength(1);
    resolve(line({ placed_at: "2026-10-08T10:00:00" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(placeCalls()).toHaveLength(1);
  });

  it("on success closes, reloads the plan and the portfolio, opens the next line and says so", async () => {
    const { sheet } = await openSheet("EIMI.L");
    typePrice(sheet, "54.6");
    const summaryCalls = () => apiFetch.mock.calls.filter(([p]) => p === "/portfolio/summary").length;
    const before = summaryCalls();
    fireEvent.click(record(sheet));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(summaryCalls()).toBeGreaterThan(before));
    expect(screen.getByText("EIMI.L recorded as placed. Next: IWDA.L, opened for you.")).toBeInTheDocument();
    expect(card("IWDA.L")).toHaveAttribute("aria-expanded", "true");
    expect(card("EIMI.L")).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(card("IWDA.L")).toHaveFocus());
  });

  it("says All lines placed after the last line", async () => {
    renderSection(plan([{ ...LINES[0], placed_at: "2026-10-08T09:30:00" }, LINES[1]]));
    await summaryLoaded();
    fireEvent.click(card("IWDA.L"));
    fireEvent.click(screen.getByRole("button", { name: "Placed" }));
    const sheet = await screen.findByRole("dialog", { name: "Record placed order" });
    typePrice(sheet, "147.2");
    fireEvent.click(record(sheet));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("IWDA.L recorded as placed. All lines placed.")).toBeInTheDocument();
    expect(card("IWDA.L")).toHaveAttribute("aria-expanded", "false");
    expect(card("EIMI.L")).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(card("IWDA.L")).toHaveFocus());
  });

  it("shows 'already recorded as placed', keeps the sheet open and reloads the plan", async () => {
    place = () => Promise.reject(new FakeApiError(409, "This line is already recorded as placed."));
    const { sheet } = await openSheet("EIMI.L");
    typePrice(sheet, "54.6");
    fireEvent.click(record(sheet));
    expect(await within(sheet).findByText("This line is already recorded as placed.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Record placed order" })).toBeInTheDocument();
    expect(record(sheet)).toBeDisabled();
  });

  it.each([
    [409, "You can keep up to 50 holdings. Remove one before adding another."],
    [422, "Input should be greater than 0"],
    [429, "Too many requests. Try again in a minute."],
  ])("shows the %i message and keeps the sheet open", async (status, detail) => {
    place = () => Promise.reject(new FakeApiError(status, detail));
    const { sheet } = await openSheet("EIMI.L");
    typePrice(sheet, "54.6");
    fireEvent.click(record(sheet));
    expect(await within(sheet).findByText(detail)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(record(sheet)).toBeEnabled();
    expect(screen.queryByText(/recorded as placed\./)).not.toBeInTheDocument();
  });

  it("shows a plain message when the server cannot be reached", async () => {
    place = () => Promise.reject(new TypeError("Failed to fetch"));
    const { sheet } = await openSheet("EIMI.L");
    typePrice(sheet, "54.6");
    fireEvent.click(record(sheet));
    expect(await within(sheet).findByText(/Could not reach the server/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Record placed order" })).toBeInTheDocument();
  });
});
