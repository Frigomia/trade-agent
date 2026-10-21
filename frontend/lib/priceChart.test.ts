import { describe, expect, it } from "vitest";
import { buildPriceChart, CHART_HEIGHT, CHART_WIDTH, cleanPoints, rangeChangePct, tickLabel } from "./priceChart";

const pts = (closes: number[]) => closes.map((close, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, close }));

describe("buildPriceChart", () => {
  it("needs two points", () => {
    expect(buildPriceChart([], "1m")).toBeNull();
    expect(buildPriceChart(pts([10]), "1m")).toBeNull();
    expect(buildPriceChart(pts([10, 12]), "1m")?.count).toBe(2);
  });

  it("keeps the line inside the plot and higher prices higher up", () => {
    const g = buildPriceChart(pts([100, 110, 105, 120]), "1m")!;
    expect(g.xAt(0)).toBeLessThan(g.xAt(3));
    expect(g.yAt(120)).toBeLessThan(g.yAt(100)); // SVG y grows downward
    expect(g.yAt(100)).toBeLessThanOrEqual(CHART_HEIGHT);
    expect(g.xAt(3)).toBeLessThanOrEqual(CHART_WIDTH);
    expect(g.linePath.startsWith("M")).toBe(true);
    expect(g.areaPath.length).toBeGreaterThan(g.linePath.length);
  });

  it("does not collapse a flat series to a zero-height scale", () => {
    const g = buildPriceChart(pts([50, 50, 50]), "1m")!;
    expect(Number.isFinite(g.yAt(50))).toBe(true);
    expect(g.yTicks.length).toBeGreaterThan(0);
  });

  it("maps a pointer x back to the nearest point and clamps at the ends", () => {
    const g = buildPriceChart(pts([1, 2, 3, 4, 5]), "1m")!;
    expect(g.indexAtX(g.xAt(2))).toBe(2);
    expect(g.indexAtX(-1000)).toBe(0);
    expect(g.indexAtX(10_000)).toBe(4);
  });

  it("labels the x axis with at most five dates", () => {
    expect(buildPriceChart(pts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), "1m")!.xTicks).toHaveLength(5);
    expect(buildPriceChart(pts([1, 2, 3]), "1m")!.xTicks).toHaveLength(3);
  });
});

describe("cleanPoints", () => {
  it("drops non-positive and non-finite closes, keeping the order", () => {
    expect(cleanPoints(pts([10, 0, Number.NaN, -3, 12])).map((p) => p.close)).toEqual([10, 12]);
  });
});

describe("x labels", () => {
  it("anchors the first label to the start and the last to the end so none spills past the plot", () => {
    const ticks = buildPriceChart(pts([1, 2, 3, 4, 5, 6, 7, 8]), "1m")!.xTicks;
    expect(ticks[0].anchor).toBe("start");
    expect(ticks[ticks.length - 1].anchor).toBe("end");
    expect(ticks[1].anchor).toBe("middle");
  });
});

describe("rangeChangePct", () => {
  it("is the change from the first to the last close, or null with nothing to compare", () => {
    expect(rangeChangePct(pts([100, 110]))).toBeCloseTo(10);
    expect(rangeChangePct(pts([200, 150]))).toBeCloseTo(-25);
    expect(rangeChangePct(pts([100]))).toBeNull();
  });
});

describe("tickLabel", () => {
  it("shows the month on long ranges and the day on short ones, in UTC", () => {
    expect(tickLabel("2026-10-19", "1y")).toBe(new Date("2026-10-19T00:00:00Z").toLocaleDateString([], { month: "short", timeZone: "UTC" }));
    expect(tickLabel("2026-10-19", "1w")).toBe(new Date("2026-10-19T00:00:00Z").toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" }));
  });
});
