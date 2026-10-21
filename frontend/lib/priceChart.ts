import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import type { HistoryRange, PriceHistory } from "@/lib/api/discovery-types";

export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 220;
// The left margin holds the price labels, as in the mock.
export const CHART_LEFT = 40;
const MARGIN = { top: 12, right: 6, bottom: 24, left: CHART_LEFT };

type Point = PriceHistory["points"][number];

/** The closes worth drawing: finite and positive. The chart and its readout both index this list. */
export function cleanPoints(points: Point[]): Point[] {
  return points.filter((p) => Number.isFinite(p.close) && p.close > 0);
}

export interface PriceChartGeometry {
  count: number;
  linePath: string;
  areaPath: string;
  yTicks: { value: number; y: number }[];
  xTicks: { label: string; x: number; anchor: "start" | "middle" | "end" }[];
  xAt: (index: number) => number;
  yAt: (value: number) => number;
  indexAtX: (x: number) => number;
}

/** "2024" for five years, "Jul" for a long range, "19 Oct" for a short one, from a YYYY-MM-DD date. */
export function tickLabel(date: string, range: HistoryRange): string {
  const day = new Date(`${date}T00:00:00Z`);
  if (range === "5y") return day.toLocaleDateString([], { year: "numeric", timeZone: "UTC" });
  return range === "1y" || range === "6m"
    ? day.toLocaleDateString([], { month: "short", timeZone: "UTC" })
    : day.toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Change over the points shown, in percent; null when there is nothing to compare. */
export function rangeChangePct(points: Point[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].close;
  return first > 0 ? ((points[points.length - 1].close - first) / first) * 100 : null;
}

/**
 * The line, its area and the axes for one price series (already through `cleanPoints`). Needs two
 * points; otherwise null, and the caller says the history is not available rather than drawing nothing.
 */
export function buildPriceChart(clean: Point[], range: HistoryRange): PriceChartGeometry | null {
  if (clean.length < 2) return null;
  const count = clean.length;
  const x = scaleLinear()
    .domain([0, count - 1])
    .range([MARGIN.left, CHART_WIDTH - MARGIN.right]);
  let min = Math.min(...clean.map((p) => p.close));
  let max = Math.max(...clean.map((p) => p.close));
  if (min === max) {
    min -= min * 0.01;
    max += max * 0.01;
  }
  const y = scaleLinear()
    .domain([min, max])
    .nice()
    .range([CHART_HEIGHT - MARGIN.bottom, MARGIN.top]);
  const baseline = CHART_HEIGHT - MARGIN.bottom;
  const linePath = line<Point>().x((_, i) => x(i)).y((d) => y(d.close))(clean) ?? "";
  const areaPath = area<Point>().x((_, i) => x(i)).y0(baseline).y1((d) => y(d.close))(clean) ?? "";
  // Five evenly spaced date labels (fewer when the series is short).
  const labelCount = Math.min(5, count);
  const xTicks = Array.from({ length: labelCount }, (_, k) => {
    const index = Math.round((k / (labelCount - 1)) * (count - 1));
    // The ends are anchored inward so a label never spills past the plot.
    return { label: tickLabel(clean[index].date, range), x: x(index), anchor: k === 0 ? ("start" as const) : k === labelCount - 1 ? ("end" as const) : ("middle" as const) };
  });
  return {
    count,
    linePath,
    areaPath,
    yTicks: y.ticks(3).map((value) => ({ value, y: y(value) })),
    xTicks,
    xAt: (index) => x(index),
    yAt: (value) => y(value),
    indexAtX: (px) => Math.min(count - 1, Math.max(0, Math.round(x.invert(px)))),
  };
}
