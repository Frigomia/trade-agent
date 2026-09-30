import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BacktestChart } from "./BacktestChart";

const CURVE = { strategy: [10000, 10500, 11234.5], buy_and_hold: [10000, 10200, 10500] };
const NAME = /strategy value against buy-and-hold/i;

function chart(curve = CURVE) {
  return render(<BacktestChart curve={curve} startDate="2023-01-02" endDate="2026-09-30" />);
}

function fakeRect(el: Element) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: 360, bottom: 200, width: 360, height: 200, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

describe("BacktestChart", () => {
  it("draws a solid and a dashed line, axis labels, a text legend and the dates", () => {
    const { container } = chart();
    const series = container.querySelectorAll('path[fill="none"]');
    expect(series).toHaveLength(2);
    expect([...series].filter((p) => p.getAttribute("stroke-dasharray"))).toHaveLength(1);
    expect(screen.getAllByText(/^\d{2},\d{3}$/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Strategy (solid line): 10,000.00 to 11,234.50")).toBeInTheDocument();
    expect(screen.getByText("Buy-and-hold (dashed line): 10,000.00 to 10,500.00")).toBeInTheDocument();
    expect(screen.getByText("2023-01-02")).toBeInTheDocument();
    expect(screen.getByText("2026-09-30")).toBeInTheDocument();
    expect(screen.getByText(/hover, or use the arrow keys/i)).toBeInTheDocument();
  });

  it("renders nothing for fewer than two points", () => {
    const { container } = chart({ strategy: [10000], buy_and_hold: [10000] });
    expect(container).toBeEmptyDOMElement();
  });

  it("does not produce NaN in any path for a flat curve", () => {
    const { container } = chart({ strategy: [10000, 10000, 10000], buy_and_hold: [10000, 10000, 10000] });
    for (const path of container.querySelectorAll("path")) {
      expect(path.getAttribute("d") ?? "").not.toMatch(/NaN|Infinity/);
    }
  });

  it("reads both values for the point under the mouse and clears on leave", () => {
    chart();
    const svg = screen.getByRole("img", { name: NAME });
    fakeRect(svg);
    fireEvent.mouseMove(svg, { clientX: 348 }); // right edge of the plot: the last point
    expect(screen.getByText("Point 3 of 3: Strategy 11,234.50, Buy-and-hold 10,500.00")).toBeInTheDocument();
    fireEvent.mouseMove(svg, { clientX: 52 }); // left edge of the plot: the first point
    expect(screen.getByText("Point 1 of 3: Strategy 10,000.00, Buy-and-hold 10,000.00")).toBeInTheDocument();
    fireEvent.mouseLeave(svg);
    expect(screen.queryByText(/^Point \d of 3/)).not.toBeInTheDocument();
  });

  it("ignores mouse moves over a zero-width rect", () => {
    chart();
    const svg = screen.getByRole("img", { name: NAME });
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    fireEvent.mouseMove(svg, { clientX: 100 });
    expect(screen.getByText("Hover, or use the arrow keys, to read a point.")).toBeInTheDocument();
    expect(screen.queryByText(/^Point/)).not.toBeInTheDocument();
  });

  it("supports End, ArrowRight from nothing, and clears on blur", () => {
    chart();
    const svg = screen.getByRole("img", { name: NAME });
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByText(/^Point 1 of 3/)).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: "End" });
    expect(screen.getByText(/^Point 3 of 3/)).toBeInTheDocument();
    fireEvent.blur(svg);
    expect(screen.queryByText(/^Point \d of 3/)).not.toBeInTheDocument();
  });

  it("can be read with the keyboard", () => {
    chart();
    const svg = screen.getByRole("img", { name: NAME });
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(screen.getByText(/^Point 3 of 3/)).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(screen.getByText(/^Point 2 of 3/)).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByText(/^Point 3 of 3/)).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: "ArrowRight" }); // clamped at the last point
    expect(screen.getByText(/^Point 3 of 3/)).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: "Home" });
    expect(screen.getByText(/^Point 1 of 3/)).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(screen.queryByText(/^Point \d of 3/)).not.toBeInTheDocument();
  });
});
