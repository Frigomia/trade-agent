import { describe, expect, it } from "vitest";
import type { HoldingSummary } from "@/lib/api/portfolio-types";
import { allocate, largestPositions, MAX_GROUPS, OTHER, OTHER_ID, UNKNOWN, wrapCaption } from "./allocation";

const holding = (ticker: string, value: number | null, over: Partial<HoldingSummary> = {}): HoldingSummary => ({
  ticker,
  name: `${ticker} Corp`,
  asset_type: "STOCK",
  shares: 10,
  cost_basis: 1,
  first_purchase_date: null,
  sector: "Technology",
  target_weight: null,
  current_price: value === null ? null : value / 10,
  market_value: value,
  unrealized_pl: null,
  unrealized_pl_pct: null,
  weight: null,
  country: "United States",
  currency: "USD",
  ...over,
});

describe("allocate", () => {
  it("groups the priced holdings by the chosen dimension, largest first, with shares that add up to 1", () => {
    const list = [holding("A", 300), holding("B", 100, { sector: "Utilities" }), holding("C", 600, { sector: "Utilities" })];

    const { groups, total } = allocate(list, "sector");

    expect(total).toBe(1000);
    expect(groups.map((g) => [g.name, g.value, g.tickers])).toEqual([
      ["Utilities", 700, ["B", "C"]],
      ["Technology", 300, ["A"]],
    ]);
    expect(groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1);
    expect(groups[0].share).toBeCloseTo(0.7);
  });

  it("groups by country and by currency too", () => {
    const list = [holding("A", 100), holding("B", 300, { country: "Japan", currency: "JPY" })];

    expect(allocate(list, "country").groups.map((g) => g.name)).toEqual(["Japan", "United States"]);
    expect(allocate(list, "currency").groups.map((g) => g.name)).toEqual(["JPY", "USD"]);
  });

  it("keeps a holding with no value for the dimension as Unknown rather than dropping it", () => {
    const list = [holding("A", 100), holding("B", 50, { sector: null }), holding("C", 40, { sector: "  " }), holding("D", 30, { country: undefined })];

    const sectors = allocate(list, "sector").groups;
    expect(sectors.find((g) => g.name === UNKNOWN)).toMatchObject({ value: 90, tickers: ["B", "C"] });
    expect(allocate(list, "country").groups.find((g) => g.name === UNKNOWN)?.tickers).toEqual(["D"]);
  });

  it("leaves out sold-out and unpriced holdings and says how many were unpriced", () => {
    const list = [holding("A", 100), holding("SOLD", 500, { shares: 0 }), holding("NOPRICE", null), holding("ZERO", 0), holding("NAN", Number.NaN)];

    const result = allocate(list, "sector");

    expect(result.total).toBe(100);
    expect(result.groups.map((g) => g.tickers)).toEqual([["A", "NOPRICE", "ZERO", "NAN"]]); // all in Technology
    expect(result.unpriced).toBe(3); // the sold-out one is not an unpriced holding
  });

  it("folds everything past the sixth group into Other, which holds their holdings", () => {
    const list = Array.from({ length: 9 }, (_, i) => holding(`T${i}`, 900 - i * 100, { sector: `S${i}` }));

    const { groups } = allocate(list, "sector");

    expect(groups).toHaveLength(MAX_GROUPS);
    expect(groups.slice(0, 5).map((g) => g.name)).toEqual(["S0", "S1", "S2", "S3", "S4"]);
    expect(groups[5]).toMatchObject({ name: OTHER, tickers: ["T5", "T6", "T7", "T8"], value: 400 + 300 + 200 + 100 });
    expect(groups.map((g) => g.id)).toEqual([...groups.slice(0, 5).map((g) => g.name), OTHER_ID]);
    expect(groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1);
  });

  it("keeps an unpriced holding in its group's tickers so a filter never hides it", () => {
    const list = [holding("A", 100), holding("NOPRICE", null), holding("U", null, { sector: "Utilities" })];

    const { groups } = allocate(list, "sector");

    expect(groups.map((g) => [g.name, g.tickers])).toEqual([["Technology", ["A", "NOPRICE"]]]); // no group of unpriced only
  });

  it("gives the folded Other its own id, apart from a real group called Other", () => {
    const list = [holding("R", 5000, { sector: OTHER }), ...Array.from({ length: 8 }, (_, i) => holding(`T${i}`, 900 - i * 100, { sector: `S${i}` }))];

    const { groups } = allocate(list, "sector");

    const others = groups.filter((g) => g.name === OTHER);
    expect(others).toHaveLength(2);
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
  });

  it("groups a fund by its group_sector label, not by the stored sector", () => {
    const fund = holding("F", 100, { asset_type: "ETF", sector: "Technology", group_sector: "ETF: Global Large-Cap Blend Equity", country: "Funds" });
    const list = [fund, holding("A", 300)];

    expect(allocate(list, "sector").groups.map((g) => [g.name, g.tickers])).toEqual([
      ["Technology", ["A"]],
      ["ETF: Global Large-Cap Blend Equity", ["F"]],
    ]);
  });

  it("falls back to the stored sector when group_sector is missing or blank", () => {
    const list = [holding("F", 100, { asset_type: "ETF", sector: "My Fund", group_sector: null }), holding("G", 50, { asset_type: "ETF", sector: "My Fund", group_sector: "  " })];

    expect(allocate(list, "sector").groups.map((g) => [g.name, g.tickers])).toEqual([["My Fund", ["F", "G"]]]);
  });

  it("makes a Funds country slice of the funds", () => {
    const list = [holding("F", 100, { asset_type: "ETF", country: "Funds" }), holding("A", 300)];

    expect(allocate(list, "country").groups.map((g) => [g.name, g.tickers])).toEqual([["United States", ["A"]], ["Funds", ["F"]]]);
  });

  it("is empty for no holdings", () => {
    expect(allocate([], "sector")).toEqual({ groups: [], total: 0, unpriced: 0 });
  });

  it("orders equal groups by name so the slices do not jump around", () => {
    const list = [holding("A", 100, { sector: "Zeta" }), holding("B", 100, { sector: "Alpha" })];

    expect(allocate(list, "sector").groups.map((g) => g.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("largestPositions", () => {
  it("lists the biggest priced open holdings with their share of the priced total", () => {
    const list = [holding("A", 100), holding("B", 300), holding("C", 600), holding("SOLD", 900, { shares: 0 }), holding("NOPRICE", null)];

    const top = largestPositions(list, 2);

    expect(top.map((p) => p.ticker)).toEqual(["C", "B"]);
    expect(top[0].share).toBeCloseTo(0.6);
    expect(top[0].name).toBe("C Corp");
  });

  it("defaults to five and is empty for nothing priced", () => {
    expect(largestPositions(Array.from({ length: 8 }, (_, i) => holding(`T${i}`, 100 + i)))).toHaveLength(5);
    expect(largestPositions([holding("A", null)])).toEqual([]);
  });
});

describe("wrapCaption", () => {
  it("wraps at spaces, greedily", () => {
    expect(wrapCaption("ETF: Global Large-Cap Blend Equity", 22, 2)).toEqual(["ETF: Global Large-Cap", "Blend Equity"]);
  });

  it("keeps a short name on one line and collapses spacing", () => {
    expect(wrapCaption("Technology", 22, 2)).toEqual(["Technology"]);
    expect(wrapCaption("  Real \n  Estate ", 22, 2)).toEqual(["Real Estate"]);
  });

  it("returns no lines for empty or blank text", () => {
    expect(wrapCaption("", 22, 2)).toEqual([]);
    expect(wrapCaption("   \t ", 22, 2)).toEqual([]);
  });

  it("ends the last line with an ellipsis when the text is cut, never past the width", () => {
    const lines = wrapCaption("word ".repeat(20).trim() + " end", 22, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(22);
  });

  it("cuts a 100-character label to two lines of at most 22", () => {
    const lines = wrapCaption("ETF: " + "Diversified-Emerging Markets ".repeat(5).slice(0, 95), 22, 2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(22);
  });

  it("hard-breaks a single word longer than the line", () => {
    expect(wrapCaption("x".repeat(40), 22, 2)).toEqual(["x".repeat(22), "x".repeat(18)]);
    const cut = wrapCaption("x".repeat(100), 22, 2);
    expect(cut[0]).toBe("x".repeat(22));
    expect(cut[1]).toBe("x".repeat(21) + "…");
  });

  it("breaks an over-long word at its hyphens first", () => {
    expect(wrapCaption("Pharmaceuticals-Biotechnology", 22, 2)).toEqual(["Pharmaceuticals-", "Biotechnology"]);
  });
});
