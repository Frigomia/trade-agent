import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import type { HistoryRange, PriceHistory } from "@/lib/api/discovery-types";

export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 220;
// The left margin holds the price labels, as in the mock. It is the minimum: it grows when the labels
// need more room (see `gutterFor`), so a label never spills out of the chart.
export const CHART_LEFT = 40;
const MARGIN = { top: 12, right: 6, bottom: 24 };
// A label this short fits the minimum margin at the 10-unit axis font; longer ones widen the margin.
const COMPACT_MAX_CHARS = 6;
const CHAR_WIDTH = 6;

type Point = PriceHistory["points"][number];

/** The closes worth drawing: finite and positive. The chart and its readout both index this list. */
export function cleanPoints(points: Point[]): Point[] {
  return points.filter((p) => Number.isFinite(p.close) && p.close > 0);
}

export interface PriceChartGeometry {
  count: number;
  linePath: string;
  areaPath: string;
  /** Width of the left margin: at least CHART_LEFT, wider when the price labels need it. */
  left: number;
  yTicks: { value: number; y: number; label: string }[];
  xTicks: { label: string; x: number; anchor: "start" | "middle" | "end" }[];
  xAt: (index: number) => number;
  yAt: (value: number) => number;
  indexAtX: (x: number) => number;
}

function labelsAt(values: number[], options: Intl.NumberFormatOptions): string[] {
  const fmt = new Intl.NumberFormat("en", options);
  return values.map((v) => fmt.format(v));
}

/** The fewest decimals (up to `max`) at which every label is different and adding one changes none. */
function fewestDecimals(values: number[], max: number, options: Intl.NumberFormatOptions): string[] | null {
  let labels = labelsAt(values, { ...options, maximumFractionDigits: 0 });
  for (let digits = 0; digits < max; digits++) {
    const finer = labelsAt(values, { ...options, maximumFractionDigits: digits + 1 });
    if (new Set(labels).size === values.length && labels.every((l, i) => l === finer[i])) return labels;
    labels = finer;
  }
  return null;
}

/**
 * The y-axis prices. Short compact labels ("300K", "1.2M") when they stay distinct and lose nothing
 * (52.5 stays 52.5, not 53); otherwise the full amount with as many decimals as it takes, so two
 * gridlines never read the same. The chart widens its left margin to fit whatever this returns.
 */
export function axisLabels(values: number[]): string[] {
  const compact = fewestDecimals(values, 6, { notation: "compact" });
  if (compact && compact.every((l) => l.length <= COMPACT_MAX_CHARS)) return compact;
  return fewestDecimals(values, 12, {}) ?? labelsAt(values, { maximumFractionDigits: 12 });
}

/** Margin in chart units for these labels at the 10-unit axis font: the minimum, or wider. */
export function gutterFor(labels: string[]): number {
  const longest = Math.max(0, ...labels.map((l) => l.length));
  return Math.max(CHART_LEFT, Math.ceil(longest * CHAR_WIDTH) + 10);
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
  const values = y.ticks(3);
  const labels = axisLabels(values);
  const left = gutterFor(labels);
  const x = scaleLinear()
    .domain([0, count - 1])
    .range([left, CHART_WIDTH - MARGIN.right]);
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
    left,
    yTicks: values.map((value, i) => ({ value, y: y(value), label: labels[i] })),
    xTicks,
    xAt: (index) => x(index),
    yAt: (value) => y(value),
    indexAtX: (px) => Math.min(count - 1, Math.max(0, Math.round(x.invert(px)))),
  };
}
