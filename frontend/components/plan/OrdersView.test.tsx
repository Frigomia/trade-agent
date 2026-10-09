import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import { copyAllText } from "@/lib/orders";
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

import { OrdersView } from "./OrdersView";
import { PortfolioTabs } from "@/components/portfolio/PortfolioTabs";

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
  shares: 1.738,
  price_eur: 53.12,
  currency: "USD",
  rate: 0.92,
  weight_before: 0.172,
  weight_after: 0.181,
  reason: "underweight",
  reason_text: "Below its target weight",
  ...o,
});
const plan = (id: number, created_at: string, amount_eur: number, lines: PlanLine[]): Plan => ({
  id,
  created_at,
  amount_eur,
  whole_shares: false,
  total_before_eur: 7710,
  leftover_eur: 0,
  lines,
  notes: [],
  disclaimer: "Advisory only. Nothing is sent to a broker.",
});
const IWDA = line({ id: 2, ticker: "IWDA.L", name: "iShares Core MSCI World", isin: "IE00B4L5Y983", amount_eur: 407.7, shares: 2.772, price_eur: 147.07 });
const NVDA = line({ id: 3, ticker: "NVDA", name: "NVIDIA Corporation", isin: null, amount_eur: 100, shares: 0.86, price_eur: 116.31 });
const CSSPX = line({ id: 4, ticker: "CSSPX.MI", name: "iShares Core S&P 500 UCITS ETF USD (Acc)", isin: "IE00B5BMR087", amount_eur: 250, shares: 0.436 });
// Midday saves, so the day is the same in every time zone the tests run in.
const OCT = plan(9, "2026-10-08T12:14:00", 600, [IWDA, NVDA]);
const SEP = plan(5, "2026-09-08T12:02:00", 500, [line({})]);
const AUG = plan(3, "2026-08-04T12:40:00", 450, [CSSPX]);

const holding = (ticker: string) => ({ ticker, name: ticker, asset_type: "ETF", shares: 1, target_weight: 0.2 });
const SUMMARY = {
  holdings: ["IWDA.L", "NVDA", "EIMI.L", "CSSPX.MI"].map(holding),
  watchlist: [],
} as unknown as PortfolioSummary;

let open: Plan[];
let failOpen: boolean;

beforeEach(() => {
  apiFetch.mockReset();
  open = [OCT, SEP, AUG];
  failOpen = false;
  apiFetch.mockImplementation((path: string) => {
    if (path === "/portfolio/summary") return Promise.resolve(SUMMARY);
    if (path === "/plans/orders/open") {
      if (failOpen) return Promise.reject(new FakeApiError(500, "boom"));
      return Promise.resolve({ open_lines: open.reduce((n, p) => n + p.lines.length, 0), plans: open });
    }
    const placed = /^\/plans\/(\d+)\/lines\/(\d+)\/placed$/.exec(path);
    if (placed) {
      // The server records it: the line is no longer open, a plan with none left drops out.
      const [pid, lid] = [Number(placed[1]), Number(placed[2])];
      open = open
        .map((p) => (p.id === pid ? { ...p, lines: p.lines.filter((l) => l.id !== lid) } : p))
        .filter((p) => p.lines.length > 0);
      return Promise.resolve(line({ id: lid, placed_at: "2026-10-09T10:00:00" }));
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderView() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PortfolioTabs current="orders" />
      <OrdersView />
    </SWRConfig>,
  );
}

const section = (name: RegExp | string) => screen.getByRole("region", { name });
const card = (ticker: string) => screen.getByRole("button", { name: new RegExp(`^${ticker.replace(".", "\\.")}, `) });
const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

async function place(ticker: string, price: string) {
  if (card(ticker).getAttribute("aria-expanded") !== "true") fireEvent.click(card(ticker));
  fireEvent.click(screen.getByRole("button", { name: "Placed" }));
  const sheet = await screen.findByRole("dialog", { name: "Record placed order" });
  fireEvent.change(within(sheet).getByLabelText("Price per share"), { target: { value: price } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Record order" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

describe("OrdersView", () => {
  it("shows one section per plan, newest first, with its heading and only its lines", async () => {
    renderView();
    expect(await screen.findByRole("heading", { name: "October 2026, 2 open" })).toBeInTheDocument();
    expect(headings()).toEqual(["October 2026, 2 open", "September 2026, 1 open", "August 2026, 1 open"]);
    const oct = section("October 2026, 2 open");
    expect(oct).toHaveTextContent("Saved 8 Oct · 600.00 EUR plan");
    expect(within(oct).getAllByRole("button", { name: /, not placed,/ }).map((b) => b.getAttribute("aria-label")?.split(",")[0])).toEqual([
      "IWDA.L",
      "NVDA",
    ]);
    expect(within(section("August 2026, 1 open")).getByText("CSSPX.MI")).toBeInTheDocument();
    // The panel's own "Orders 0 of 2 placed" header and total are not repeated under the heading.
    expect(screen.queryByText(/of \d placed/)).not.toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    expect(screen.getByText("Tap a line to open its order. After Placed, the next open line of that plan opens by itself.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Orders, 4 open orders" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b(Buy|Sell)\b/i);
  });

  it("shows the old-plan note from 15 days, not at exactly 14", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    open = [plan(9, "2026-09-25T12:00:00", 600, [IWDA]), plan(5, "2026-09-24T12:00:00", 500, [line({})])];
    renderView();
    const regions = await screen.findAllByRole("region", { name: "September 2026, 1 open" });
    expect(regions).toHaveLength(2);
    expect(regions[0]).toHaveTextContent("IWDA.L"); // saved 14 days ago to the minute
    expect(regions[0]).not.toHaveTextContent(/Planned/);
    expect(regions[1]).toHaveTextContent(
      "Planned 24 Sep. Prices and weights have moved since; make a new plan if this is no longer what you want.",
    );
    expect(regions[1]).toHaveTextContent("Saved 24 Sep · 500.00 EUR plan");
  });

  it("copies only that plan's lines with its Copy all lines", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderView();
    const oct = await screen.findByRole("region", { name: "October 2026, 2 open" });
    fireEvent.click(within(oct).getByRole("button", { name: "Copy all lines" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(copyAllText(OCT)));
    expect(writeText.mock.calls[0][0]).not.toContain("EIMI.L");
    expect(writeText.mock.calls[0][0]).not.toContain("CSSPX.MI");
  });

  it("after Placed drops the card, lowers the count and the badge, and opens the plan's next line", async () => {
    renderView();
    await screen.findByRole("heading", { name: "October 2026, 2 open" });
    await screen.findByRole("link", { name: "Orders, 4 open orders" });
    const reads = () => apiFetch.mock.calls.filter(([p]) => p === "/plans/orders/open").length;
    const before = reads();
    await place("IWDA.L", "147.2");
    expect(await screen.findByRole("heading", { name: "October 2026, 1 open" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^IWDA\.L, / })).not.toBeInTheDocument();
    expect(screen.getByText("IWDA.L recorded as placed. Next: NVDA, opened for you.")).toBeInTheDocument();
    expect(card("NVDA")).toHaveAttribute("aria-expanded", "true");
    expect(card("NVDA")).toHaveFocus(); // a next line opened: its card keeps the focus
    expect(await screen.findByRole("link", { name: "Orders, 3 open orders" })).toBeInTheDocument();
    // One refetch of the open orders per placement, not two (the view's reload is the same read).
    await new Promise((r) => setTimeout(r, 50));
    expect(reads() - before).toBe(1);
  });

  it("still reloads the open orders when the line was already recorded elsewhere (409)", async () => {
    renderView();
    await screen.findByRole("heading", { name: "October 2026, 2 open" });
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string) => {
      if (path === "/plans/9/lines/2/placed") {
        open = open.map((p) => (p.id === 9 ? { ...p, lines: p.lines.filter((l) => l.id !== 2) } : p));
        return Promise.reject(new FakeApiError(409, "This line is already recorded as placed."));
      }
      return base(path);
    });
    fireEvent.click(card("IWDA.L"));
    fireEvent.click(screen.getByRole("button", { name: "Placed" }));
    const sheet = await screen.findByRole("dialog", { name: "Record placed order" });
    fireEvent.change(within(sheet).getByLabelText("Price per share"), { target: { value: "147.2" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Record order" }));
    expect(await within(sheet).findByText("This line is already recorded as placed.")).toBeInTheDocument();
    // The sheet stays open (the page behind it is aria-hidden), and the list behind it was reloaded.
    expect(await screen.findByRole("heading", { name: "October 2026, 1 open", hidden: true })).toBeInTheDocument();
  });

  it("puts a scroll margin the height of the sticky heading on the cards", async () => {
    renderView();
    await screen.findByRole("heading", { name: "October 2026, 2 open" });
    const item = card("IWDA.L").closest("li")!;
    expect(getComputedStyle(item).scrollMarginTop).toBe("72px");
  });

  it("removes a plan's section when its last line is placed, and says so", async () => {
    renderView();
    await screen.findByRole("heading", { name: "August 2026, 1 open" });
    await place("CSSPX.MI", "573.4");
    await waitFor(() => expect(headings()).toEqual(["October 2026, 2 open", "September 2026, 1 open"]));
    const status = screen.getByText("CSSPX.MI recorded as placed. It was the last open order of August 2026.");
    // The section is gone: the focus moves to the message instead of falling to the page.
    expect(status).toHaveFocus();
    expect(status).toHaveAttribute("tabindex", "-1");
    expect(await screen.findByRole("link", { name: "Orders, 3 open orders" })).toBeInTheDocument();
  });

  it("shows the empty state, without a badge, once the last open line is placed", async () => {
    open = [SEP];
    renderView();
    await screen.findByRole("link", { name: "Orders, 1 open order" });
    await place("EIMI.L", "54.6");
    expect(await screen.findByRole("heading", { name: "No open orders." })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "Orders" })).toBeInTheDocument());
  });

  it("explains where orders come from when nothing is open", async () => {
    open = [];
    renderView();
    expect(await screen.findByRole("heading", { name: "No open orders." })).toBeInTheDocument();
    expect(screen.getByText(/^Orders come from saving a plan\. Make this month's plan and press Save plan/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to This month" })).toHaveAttribute("href", "/portfolio/plan");
    expect(screen.getByRole("link", { name: "Orders" })).toBeInTheDocument();
  });

  it("shows a readable error with Retry", async () => {
    failOpen = true;
    renderView();
    expect(await screen.findByText("Could not load your open orders.")).toBeInTheDocument();
    failOpen = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "October 2026, 2 open" })).toBeInTheDocument();
    expect(screen.queryByText("Could not load your open orders.")).not.toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    renderView();
    expect(screen.getByTestId("orders-loading")).toBeInTheDocument();
    expect(screen.queryByText("No open orders.")).not.toBeInTheDocument();
  });

  it("renders tickers, names and ISINs as plain text", async () => {
    const odd = line({ id: 7, ticker: "<b>X</b>", name: "<img src=x onerror=alert(1)>", isin: "<i>IE</i>" });
    open = [plan(9, "2026-10-08T12:14:00", 600, [odd])];
    renderView();
    const button = await screen.findByRole("button", { name: /^<b>X<\/b>, / });
    fireEvent.click(button);
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByText(/· ISIN <i>IE<\/i> ·/)).toBeInTheDocument();
  });
});
