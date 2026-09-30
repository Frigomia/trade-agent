import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { BacktestResult } from "@/lib/backtest";
import { BacktestResultPanel } from "./BacktestResultPanel";

const RESULT: BacktestResult = {
  id: 1,
  created_at: "2026-09-30T10:00:00",
  ticker: "AAPL",
  start_date: "2023-01-02",
  end_date: "2026-09-30",
  final_value: 11000,
  buy_and_hold_value: 10500,
  excess_return_pct: 0.0476,
  hit_rate_by_signal: {
    STRONG_UPTREND: { count: 12, avg_forward_return_pct: 0.0238, hit_rate: 0.65 },
    OVERSOLD: { count: 3, avg_forward_return_pct: -0.01, hit_rate: 0.3333 },
  },
  status: "DONE",
  equity_curve: { strategy: [10000, 11000], buy_and_hold: [10000, 10500] },
};

describe("BacktestResultPanel", () => {
  it("shows the start value, both end values and the excess with a word", () => {
    render(<BacktestResultPanel result={RESULT} />);
    expect(screen.getByRole("heading", { name: /AAPL, 2023-01-02 to 2026-09-30/ })).toBeInTheDocument();
    expect(screen.getByText("Both start from 10,000.00.")).toBeInTheDocument();
    expect(screen.getByText("Strategy ends at 11,000.00")).toBeInTheDocument();
    expect(screen.getByText("Buy-and-hold ends at 10,500.00")).toBeInTheDocument();
    expect(screen.getByText("Ahead of buy-and-hold by +4.8%")).toBeInTheDocument();
  });

  it("converts the per-signal fractions and flags the small sample", () => {
    render(<BacktestResultPanel result={RESULT} />);
    const row = screen.getByRole("row", { name: /strong uptrend/i });
    expect(within(row).getByText("12")).toBeInTheDocument();
    expect(within(row).getByText("+2.4%")).toBeInTheDocument();
    expect(within(row).getByText("65%")).toBeInTheDocument();
    expect(screen.getByText(/seen fewer than 5 times/i)).toBeInTheDocument();
  });

  it("shows the table without the small-sample note when every signal has 5 or more", () => {
    const signals = {
      STRONG_UPTREND: { count: 12, avg_forward_return_pct: 0.0238, hit_rate: 0.65 },
      OVERSOLD: { count: 5, avg_forward_return_pct: -0.01, hit_rate: 0.4 },
    };
    render(<BacktestResultPanel result={{ ...RESULT, hit_rate_by_signal: signals }} />);
    expect(screen.getByRole("table", { name: "Signal hit rates" })).toBeInTheDocument();
    expect(screen.queryByText(/seen fewer than 5 times/i)).not.toBeInTheDocument();
  });

  it("shows the chart when a curve is stored and hides it for an older run", () => {
    const { rerender } = render(<BacktestResultPanel result={RESULT} />);
    expect(screen.getByRole("img", { name: /strategy value against buy-and-hold/i })).toBeInTheDocument();
    rerender(<BacktestResultPanel result={{ ...RESULT, equity_curve: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Strategy ends at 11,000.00")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /strong uptrend/i })).toBeInTheDocument();
  });

  it("says so when no signals fired and always carries the disclaimer", () => {
    render(<BacktestResultPanel result={{ ...RESULT, hit_rate_by_signal: {} }} />);
    expect(screen.getByText("No signals fired in this range.")).toBeInTheDocument();
    expect(screen.queryByText(/seen fewer than 5 times/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Past performance is not a forecast. Simulated on past prices only; nothing is sent to a broker."),
    ).toBeInTheDocument();
  });
});
