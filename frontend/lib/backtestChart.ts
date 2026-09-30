import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import type { EquityCurve } from "@/lib/backtest";

export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 170;
export const CHART_MARGIN = { top: 10, right: 4, bottom: 4, left: 4 };

export interface ChartGeometry {
  count: number;
  strategyPath: string;
  buyAndHoldPath: string;
  yTicks: { value: number; y: number }[];
  xAt: (index: number) => number;
  yAt: (value: number) => number;
  indexAtX: (x: number) => number;
}

export function buildChart(curve: EquityCurve): ChartGeometry | null {
  const count = Math.min(curve.strategy.length, curve.buy_and_hold.length);
  if (count < 2) return null;
  const strategy = curve.strategy.slice(0, count);
  const buyAndHold = curve.buy_and_hold.slice(0, count);

  const x = scaleLinear()
    .domain([0, count - 1])
    .range([CHART_MARGIN.left, CHART_WIDTH - CHART_MARGIN.right]);

  let min = Math.min(...strategy, ...buyAndHold);
  let max = Math.max(...strategy, ...buyAndHold);
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.01;
    min -= pad;
    max += pad;
  }
  const y = scaleLinear()
    .domain([min, max])
    .nice()
    .range([CHART_HEIGHT - CHART_MARGIN.bottom, CHART_MARGIN.top]);

  const toPath = line<number>()
    .x((_, i) => x(i))
    .y((d) => y(d));

  return {
    count,
    strategyPath: toPath(strategy) ?? "",
    buyAndHoldPath: toPath(buyAndHold) ?? "",
    yTicks: y.ticks(4).map((value) => ({ value, y: y(value) })),
    xAt: (index) => x(index),
    yAt: (value) => y(value),
    indexAtX: (px) => Math.min(count - 1, Math.max(0, Math.round(x.invert(px)))),
  };
}

export function formatTick(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
