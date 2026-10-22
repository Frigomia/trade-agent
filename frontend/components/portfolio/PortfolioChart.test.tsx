import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Snapshot } from "@/lib/api/portfolio-types";
import { PortfolioChart, collapseByDay } from "./PortfolioChart";

let nextId = 1;
function snap(created_at: string, value: number): Snapshot {
  return { id: nextId++, created_at, total_market_value: value, total_cost_basis: 1000 };
}

function pointCount(container: HTMLElement): number {
  const points = container.querySelector("polyline")?.getAttribute("points") ?? "";
  return points.trim() === "" ? 0 : points.trim().split(" ").length;
}

describe("PortfolioChart", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    nextId = 1;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses same-day snapshots to the last one of that day, oldest first", () => {
    const collapsed = collapseByDay([
      snap("2026-09-29T18:00:00", 105),
      snap("2026-09-28T09:00:00", 100),
      snap("2026-09-29T08:00:00", 103),
    ]);

    expect(collapsed.map((s) => s.total_market_value)).toEqual([100, 105]);
  });

  it("explains itself instead of drawing a fake line with fewer than two points", () => {
    render(<PortfolioChart snapshots={[snap("2026-09-29T08:00:00", 100)]} />);

    expect(screen.getByText(/your history starts when a day is saved/i)).toBeInTheDocument();
  });

  it("draws one point per day", () => {
    const { container } = render(
      <PortfolioChart
        snapshots={[
          snap("2026-09-28T09:00:00", 100),
          snap("2026-09-29T08:00:00", 103),
          snap("2026-09-29T18:00:00", 105),
        ]}
      />,
    );

    expect(pointCount(container)).toBe(2);
  });

  it("hides the cost comparison for a period containing incomplete purchase costs", () => {
    const snapshots = [snap("2026-09-28T09:00:00", 1000),
      { ...snap("2026-09-29T09:00:00", 6000), total_cost_basis: 800, cost_basis_complete: false }];
    const { container, rerender } = render(<PortfolioChart snapshots={snapshots} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
    expect(screen.queryByText("Cost basis")).not.toBeInTheDocument();
    expect(screen.getByText(/cost comparison unavailable/i)).toBeInTheDocument();
    rerender(<PortfolioChart snapshots={snapshots.map((s) => ({ ...s, cost_basis_complete: true }))} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
    expect(screen.getByText("Cost basis")).toBeInTheDocument();
  });

  it("filters by the selected range: 1M, 6M, 1Y (the start) and All", () => {
    const snapshots = [
      snap("2025-01-01T00:00:00", 50),
      snap("2026-08-01T00:00:00", 90),
      snap("2026-09-29T00:00:00", 100),
    ];
    const { container } = render(<PortfolioChart snapshots={snapshots} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["1M", "6M", "1Y", "All"]);
    expect(screen.getByRole("button", { name: "1Y" })).toHaveAttribute("aria-pressed", "true");
    expect(pointCount(container)).toBe(2); // 1Y: the 2025 point is out
    fireEvent.click(screen.getByText("All"));
    expect(pointCount(container)).toBe(3);
    fireEvent.click(screen.getByText("1M"));
    expect(screen.getByText(/your history starts when a day is saved/i)).toBeInTheDocument();
  });

  it("puts the title on the left of the same row as the range control, with no gap above the chart", () => {
    const { container } = render(
      <PortfolioChart heading={<h2>Value over time</h2>} snapshots={[snap("2026-09-28T09:00:00", 100), snap("2026-09-29T08:00:00", 103)]} />,
    );

    const title = screen.getByRole("heading", { name: "Value over time" });
    const ranges = screen.getByRole("group", { name: "Chart range" });
    expect(title.parentElement).toBe(ranges.parentElement); // one row
    expect(title.compareDocumentPosition(ranges) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // title first
    expect(container.querySelectorAll("h2")).toHaveLength(1);
  });

  it("labels the value scale at the left, the dates under the plot, and marks the latest value", () => {
    const snapshots = [
      snap("2026-04-01T00:00:00", 16100),
      snap("2026-05-15T00:00:00", 17500),
      snap("2026-07-01T00:00:00", 17900),
      snap("2026-09-01T00:00:00", 18300),
      snap("2026-09-29T00:00:00", 18900),
    ];
    // Without the cost line, the scale is the value's own.
    const { container } = render(<PortfolioChart snapshots={snapshots.map((s) => ({ ...s, cost_basis_complete: false }))} />);

    expect(screen.getByText("18.9k")).toBeInTheDocument();
    expect(screen.getByText("16.1k")).toBeInTheDocument();
    expect(screen.getByText("17.5k")).toBeInTheDocument(); // the middle of the scale
    expect(screen.getByText("Apr")).toBeInTheDocument(); // a chart over months is labelled by month
    expect(screen.getByText("Sep")).toBeInTheDocument();
    expect(container.querySelectorAll("line")).toHaveLength(3); // a gridline for each value label
  });

  it("labels a short chart by day and month instead", () => {
    render(<PortfolioChart snapshots={[snap("2026-09-10T00:00:00", 100), snap("2026-09-20T00:00:00", 110), snap("2026-09-29T00:00:00", 120)]} />);

    expect(screen.getByText("10 Sep")).toBeInTheDocument();
    expect(screen.getByText("29 Sep")).toBeInTheDocument();
  });

  it("the sparkline variant has no range chips and draws nothing under two points", () => {
    const { container, rerender } = render(
      <PortfolioChart
        variant="sparkline"
        snapshots={[snap("2026-09-28T09:00:00", 100), snap("2026-09-29T08:00:00", 103)]}
      />,
    );

    expect(pointCount(container)).toBe(2);
    expect(screen.queryByText("1W")).not.toBeInTheDocument();

    rerender(<PortfolioChart variant="sparkline" snapshots={[snap("2026-09-29T08:00:00", 1)]} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
