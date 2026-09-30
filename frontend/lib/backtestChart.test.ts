import { describe, it, expect } from "vitest";
import { buildChart, CHART_HEIGHT, CHART_MARGIN, CHART_WIDTH } from "./backtestChart";

describe("buildChart", () => {
  it("returns null with fewer than two points", () => {
    expect(buildChart({ strategy: [10000], buy_and_hold: [10000] })).toBeNull();
    expect(buildChart({ strategy: [], buy_and_hold: [] })).toBeNull();
  });

  it("puts both lines on one shared scale with higher values higher on screen", () => {
    const g = buildChart({ strategy: [10000, 12000], buy_and_hold: [10000, 11000] })!;
    expect(g.count).toBe(2);
    expect(g.yAt(12000)).toBeLessThan(g.yAt(11000));
    expect(g.yAt(11000)).toBeLessThan(g.yAt(10000));
    expect(g.xAt(0)).toBe(CHART_MARGIN.left);
    expect(g.xAt(1)).toBe(CHART_WIDTH - CHART_MARGIN.right);
    expect(g.strategyPath).toMatch(/^M/);
    expect(g.buyAndHoldPath).toMatch(/^M/);
  });

  it("gives tick positions inside the drawing area", () => {
    const g = buildChart({ strategy: [10000, 12000], buy_and_hold: [10000, 11000] })!;
    expect(g.yTicks.length).toBeGreaterThanOrEqual(2);
    for (const tick of g.yTicks) {
      expect(tick.y).toBeGreaterThanOrEqual(CHART_MARGIN.top);
      expect(tick.y).toBeLessThanOrEqual(CHART_HEIGHT - CHART_MARGIN.bottom);
    }
  });

  it("never emits NaN or Infinity for a flat curve", () => {
    const g = buildChart({ strategy: [10000, 10000, 10000], buy_and_hold: [10000, 10000, 10000] })!;
    expect(g.strategyPath).not.toMatch(/NaN|Infinity/);
    expect(g.buyAndHoldPath).not.toMatch(/NaN|Infinity/);
    expect(Number.isFinite(g.yAt(10000))).toBe(true);
    for (const tick of g.yTicks) expect(Number.isFinite(tick.y)).toBe(true);
  });

  it("maps an x position to the nearest point and clamps at the ends", () => {
    const g = buildChart({
      strategy: [1, 2, 3, 4, 5],
      buy_and_hold: [1, 2, 3, 4, 5],
    })!;
    expect(g.indexAtX(g.xAt(2))).toBe(2);
    expect(g.indexAtX(g.xAt(3) - 1)).toBe(3);
    expect(g.indexAtX(-50)).toBe(0);
    expect(g.indexAtX(9999)).toBe(4);
  });

  it("uses the shorter list when lengths differ", () => {
    const g = buildChart({ strategy: [1, 2, 3], buy_and_hold: [1, 2] })!;
    expect(g.count).toBe(2);
  });
});
