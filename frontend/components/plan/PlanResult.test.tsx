import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { normalisePlan, type LeftOut, type Plan, type PlanLine } from "@/lib/plans";
import { PlanResult } from "./PlanResult";

const line = (o: Partial<PlanLine> = {}): PlanLine => ({
  id: null,
  isin: null,
  placed_at: null,
  placed_trade_id: null,
  placed_shares: null,
  placed_price: null,
  ticker: "MSFT",
  name: "Microsoft",
  amount_eur: 312.04,
  shares: 0.795,
  price_eur: 392.18,
  currency: "USD",
  rate: 0.9226,
  weight_before: 0.179,
  weight_after: 0.184,
  reason: "underweight",
  reason_text: "Below its target weight",
  target_weight: 0.19,
  ...o,
});
const NVDA: LeftOut = { ticker: "NVDA", name: "NVIDIA <b>Corp</b>", kind: "unpriced", reason: "No price available." };
const AAPL: LeftOut = { ticker: "AAPL", name: "Apple", kind: "excluded_call", reason: "Its newest pending call is <i>SELL</i>." };
const plan = (o: Partial<Plan> = {}): Plan => ({
  id: null,
  created_at: null,
  amount_eur: 500,
  whole_shares: false,
  total_before_eur: 7650,
  leftover_eur: 187.96,
  lines: [line()],
  left_out: [],
  notes: [],
  disclaimer: "Advisory only. Nothing is sent to a broker.",
  ...o,
});
const leftPct = (tick: HTMLElement) => parseFloat(tick.style.left);

describe("PlanResult", () => {
  it("draws the target tick and says the target in the numbers line", () => {
    render(<PlanResult plan={plan()} />);
    const row = within(screen.getByRole("table", { name: "Plan lines" })).getAllByRole("row")[1];
    expect(row).toHaveTextContent("Weight 17.9% to 18.4% · target 19.0%");
    expect(row).not.toHaveTextContent(/your target/i);
    const tick = within(row).getByTestId("target-tick");
    // The scale is the largest of before, after and target, plus headroom: 0.19 * 1.15.
    expect(leftPct(tick)).toBeCloseTo((0.19 / (0.19 * 1.15)) * 100, 5);
    expect(screen.getByText("target (within this plan)")).toBeInTheDocument();
  });

  it("keeps the tick inside the track when the target is above every weight", () => {
    render(<PlanResult plan={plan({ lines: [line({ target_weight: 0.6 }), line({ ticker: "SAP", target_weight: 0.05 })] })} />);
    const ticks = screen.getAllByTestId("target-tick");
    expect(ticks).toHaveLength(2);
    ticks.forEach((t) => {
      expect(leftPct(t)).toBeGreaterThan(0);
      expect(leftPct(t)).toBeLessThan(100);
    });
  });

  it("shows no tick and the old numbers line when the line has no target", () => {
    render(<PlanResult plan={plan({ lines: [line({ target_weight: null })] })} />);
    const row = within(screen.getByRole("table", { name: "Plan lines" })).getAllByRole("row")[1];
    expect(row).toHaveTextContent("Weight 17.9% to 18.4%392.18 EUR");
    expect(row).not.toHaveTextContent("· target");
    expect(screen.queryByTestId("target-tick")).not.toBeInTheDocument();
    expect(screen.queryByText("target")).not.toBeInTheDocument();
  });

  it("lists the left-out tickers after the funded lines, at 0.00 and outside the total", () => {
    render(<PlanResult plan={plan({ left_out: [AAPL, NVDA], notes: ["1 holding has no target weight and is left out of the plan (VUSA)."] })} />);
    const rows = within(screen.getByRole("table", { name: "Plan lines" })).getAllByRole("row");
    // Header, MSFT, AAPL, NVDA, Total.
    expect(rows).toHaveLength(5);
    expect(rows[1]).toHaveTextContent("MSFT");
    const nvda = rows[3];
    expect(within(nvda).getByText("NVDA")).toBeInTheDocument();
    expect(within(nvda).getByText("NVIDIA <b>Corp</b>")).toBeInTheDocument();
    expect(within(nvda).getByText("No price available.")).toBeInTheDocument();
    expect(within(nvda).getByText("0.00")).toBeInTheDocument();
    expect(within(nvda).queryByTestId("target-tick")).not.toBeInTheDocument();
    expect(nvda).not.toHaveTextContent("Weight");
    expect(within(rows[2]).getByText("Its newest pending call is <i>SELL</i>.")).toBeInTheDocument();
    expect(rows[4]).toHaveTextContent("Total");
    expect(rows[4]).toHaveTextContent("Leftover 187.96 EUR");
    expect(rows[4]).toHaveTextContent("312.04 EUR");
    expect(screen.getByText("1 holding has no target weight and is left out of the plan (VUSA).")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b(Buy|Sell)\b/);
  });

  it("lists the left-out tickers on Nothing to fund", () => {
    render(<PlanResult plan={plan({ lines: [], leftover_eur: 500, left_out: [AAPL, NVDA], notes: ["Every ticker with a target is excluded or unpriced, so nothing is proposed."] })} />);
    expect(screen.getByRole("heading", { name: "Nothing to fund this month" })).toBeInTheDocument();
    expect(screen.getByText("Every ticker with a target is left out, so the plan proposes nothing.", { exact: false })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Left out of the plan" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("NVDA")).toBeInTheDocument();
    expect(within(list).getByText("No price available.")).toBeInTheDocument();
    expect(within(list).getByText("NVIDIA <b>Corp</b>", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Plan notes" })).toHaveTextContent("Every ticker with a target is excluded or unpriced");
    expect(screen.queryByText(/not enough for one whole share/)).not.toBeInTheDocument();
  });

  it("chooses the whole-shares copy when a ticker is too small for one share", () => {
    const tooSmall: LeftOut = { ticker: "MSFT", name: "Microsoft", kind: "too_small", reason: "40.00 EUR is less than one share (392.18 EUR)." };
    render(<PlanResult plan={plan({ whole_shares: true, lines: [], leftover_eur: 500, left_out: [tooSmall] })} />);
    expect(screen.getByText(/This amount is not enough for one whole share/)).toBeInTheDocument();
    expect(screen.getByText("40.00 EUR is less than one share (392.18 EUR).")).toBeInTheDocument();
  });

  it("renders a response without the new fields, with no tick and no left-out rows", () => {
    const { left_out: _left, ...rest } = plan({ lines: [line({ target_weight: null })] });
    void _left;
    render(<PlanResult plan={normalisePlan({ ...rest, lines: [{ ...line(), target_weight: undefined } as unknown as PlanLine] } as Plan)} />);
    expect(screen.queryByTestId("target-tick")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Left out of the plan" })).not.toBeInTheDocument();
  });

  it("still shows an old plan's notes, which carry its ticker sentences", () => {
    render(<PlanResult plan={plan({ lines: [], leftover_eur: 500, notes: ["MSFT gets no money: its newest pending call is TRIM."] })} />);
    expect(screen.getByText("MSFT gets no money: its newest pending call is TRIM.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Left out of the plan" })).not.toBeInTheDocument();
  });
});
