import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";
import { OverviewStrip } from "./OverviewStrip";

const SUMMARY: PortfolioSummary = {
  holdings: [],
  watchlist: [],
  total_market_value: 18910.5,
  total_cost_basis: 16000,
  total_pl: 2910.5,
  total_pl_pct: 18.2,
  unpriced_count: 0,
  unknown_basis_count: 0,
  pl_covered_count: 7,
  pl_complete: true,
};

const days = (n: number): Snapshot[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    created_at: `2026-10-${String(i + 1).padStart(2, "0")}T08:00:00`,
    total_market_value: 18000 + i * 100,
    total_cost_basis: 16000,
    cost_basis_complete: true,
  }));

const show = (summary: Partial<PortfolioSummary> = {}, snapshots: Snapshot[] | undefined = days(8), openCount = 7) =>
  render(<OverviewStrip summary={{ ...SUMMARY, ...summary }} openCount={openCount} snapshots={snapshots} />);

describe("OverviewStrip", () => {
  it("shows the total value, the gain with its percent, and says today's change is not available", () => {
    show();

    expect(screen.getByText("Total value").parentElement).toHaveTextContent("18,910.50");
    expect(screen.getByText("Total value").parentElement).toHaveTextContent("7 holdings · amounts as entered");
    const gain = screen.getByText("Total gain or loss").parentElement!;
    expect(gain).toHaveTextContent("+2,910.50");
    expect(gain).toHaveTextContent("+18.2%");
    expect(screen.getByText("Today").parentElement).toHaveTextContent("Not available");
  });

  it("shows a loss with its sign and colours only the price move", () => {
    show({ total_pl: -120, total_pl_pct: -0.6 });

    const gain = screen.getByText("Total gain or loss").parentElement!;
    expect(gain).toHaveTextContent("-120.00");
    expect(gain).toHaveTextContent("-0.6%");
    expect(screen.getByText(/-120.00/)).toHaveStyle({ color: "var(--down)" });
    expect(screen.getByText("Today").parentElement).not.toHaveStyle({ color: "var(--down)" });
  });

  it("says Not available with how to fix it when no holding has a purchase price", () => {
    show({ pl_covered_count: 0, unknown_basis_count: 7, total_pl: 0, total_pl_pct: null });

    const gain = screen.getByText("Total gain or loss").parentElement!;
    expect(gain).toHaveTextContent("Not available");
    expect(gain).toHaveTextContent("Add purchase prices to see it");
    expect(gain).not.toHaveTextContent("0.00");
  });

  it("blames the quotes, not the costs, when every cost is known but the prices are missing", () => {
    show({ pl_covered_count: 0, unknown_basis_count: 0, unpriced_count: 3, total_pl: 0, total_pl_pct: null });

    const gain = screen.getByText("Total gain or loss").parentElement!;
    expect(gain).toHaveTextContent("Not available");
    expect(gain).toHaveTextContent(/have no live price, so there is no gain or loss/);
    expect(gain).not.toHaveTextContent(/Add purchase prices/);
  });

  it("names both causes when some purchase prices and some quotes are missing", () => {
    show({ pl_covered_count: 0, unknown_basis_count: 2, unpriced_count: 1, total_pl: 0, total_pl_pct: null });

    const gain = screen.getByText("Total gain or loss").parentElement!;
    expect(gain).toHaveTextContent(/missing a purchase price or a live price/);
    expect(gain).toHaveTextContent(/Add the purchase prices/);
  });

  it("does not guess a cause when nothing is missing", () => {
    show({ pl_covered_count: 0, unknown_basis_count: 0, unpriced_count: 0, total_pl: 0, total_pl_pct: null });

    const gain = screen.getByText("Total gain or loss").parentElement!;
    expect(gain).toHaveTextContent(/not enough price and cost data/i);
    expect(gain).not.toHaveTextContent(/Add purchase prices/);
  });

  it("names the holdings left out of the gain, and the ones with no live price", () => {
    show({ unknown_basis_count: 2, unpriced_count: 1 });

    expect(screen.getByText("Total gain or loss").parentElement).toHaveTextContent("2 holdings without a purchase price are left out");
    expect(screen.getByText(/1 holding has no live price and isn't in these totals/)).toBeInTheDocument();
  });

  it("draws the value chart once there are enough days of saved values", () => {
    show({}, days(7));

    expect(screen.getByRole("img", { name: "Portfolio value over time" })).toBeInTheDocument();
    expect(screen.queryByText(/needs a little more history/i)).not.toBeInTheDocument();
  });

  it("waits for history instead of drawing a line through a few points, and says how many it has", () => {
    show({}, days(3));

    expect(screen.getByText("The chart needs a little more history")).toBeInTheDocument();
    expect(screen.getByText(/at least 7 days of saved values. You have 3 so far/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Portfolio value over time" })).not.toBeInTheDocument();
  });

  it("counts a day once however many snapshots were saved on it", () => {
    const twice = [...days(6), { ...days(1)[0], id: 99, created_at: "2026-10-01T20:00:00" }];

    show({}, twice);

    expect(screen.getByText(/You have 6 so far/)).toBeInTheDocument();
  });

  it("says the history could not be loaded instead of waiting for it forever", () => {
    render(<OverviewStrip summary={SUMMARY} openCount={7} snapshots={undefined} snapshotsFailed />);

    expect(screen.getByText(/saved values could not be loaded/i)).toBeInTheDocument();
    expect(document.querySelector("[aria-busy]")).toBeNull();
  });

  it("shows a placeholder while the history loads", () => {
    // undefined means not loaded yet (a default parameter would fill it in, so render directly)
    render(<OverviewStrip summary={SUMMARY} openCount={7} snapshots={undefined} />);

    expect(document.querySelector("[aria-busy]")).not.toBeNull();
    expect(screen.queryByText(/needs a little more history/i)).not.toBeInTheDocument();
  });
});
