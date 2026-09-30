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

    expect(screen.getByText(/record a snapshot to start your history/i)).toBeInTheDocument();
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

  it("filters by the selected range", () => {
    const snapshots = [
      snap("2025-01-01T00:00:00", 50),
      snap("2026-09-01T00:00:00", 90),
      snap("2026-09-29T00:00:00", 100),
    ];
    const { container } = render(<PortfolioChart snapshots={snapshots} />);

    expect(pointCount(container)).toBe(2); // default 3M: the 2025 point is out
    fireEvent.click(screen.getByText("All"));
    expect(pointCount(container)).toBe(3);
    fireEvent.click(screen.getByText("1W"));
    expect(screen.getByText(/record a snapshot to start your history/i)).toBeInTheDocument();
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
