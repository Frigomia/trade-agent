import { describe, expect, it } from "vitest";
import type { DiscoverItem } from "@/lib/api/discover-types";
import { addedText, counts, isAnalyzed, metaText, nameOf, priceText, visibleItems } from "./discoverList";

const item = (ticker: string, over: Partial<DiscoverItem> = {}): DiscoverItem => ({
  ticker,
  asset_type: "STOCK",
  name: `${ticker} Corp`,
  exchange: "NASDAQ",
  currency: "USD",
  source: "manual",
  added_at: "2026-10-20T08:00:00",
  note: null,
  target_weight: null,
  target_price_low: null,
  target_price_high: null,
  price: 100,
  change_pct: 0,
  price_as_of: "2026-10-21",
  stale: false,
  status: "none",
  insight: null,
  report_id: null,
  ...over,
});

const names = (list: DiscoverItem[]) => list.map((i) => i.ticker);

describe("counts and filters", () => {
  const list = [item("A", { status: "analyzed", report_id: 1 }), item("B"), item("C", { status: "analyzed", report_id: 2 }), item("D")];

  it("counts each filter", () => {
    expect(counts(list)).toEqual({ all: 4, analyzed: 2, none: 2 });
    expect(counts([])).toEqual({ all: 0, analyzed: 0, none: 0 });
  });

  it("counts a company as analyzed only when there is a report to open, so the filter, count and card agree", () => {
    const orphan = item("X", { status: "analyzed", report_id: null });

    expect(isAnalyzed(orphan)).toBe(false);
    expect(isAnalyzed(item("Y", { status: "analyzed", report_id: 3 }))).toBe(true);
    expect(counts([orphan, item("Y", { status: "analyzed", report_id: 3 })])).toEqual({ all: 2, analyzed: 1, none: 1 });
    expect(names(visibleItems([orphan], "none", "name"))).toEqual(["X"]);
  });

  it("shows all, only the analyzed, or only the not analyzed", () => {
    expect(names(visibleItems(list, "all", "name"))).toEqual(["A", "B", "C", "D"]);
    expect(names(visibleItems(list, "analyzed", "name"))).toEqual(["A", "C"]);
    expect(names(visibleItems(list, "none", "name"))).toEqual(["B", "D"]);
  });
});

describe("visibleItems sort", () => {
  it("puts the newest first and an item with no recorded date last", () => {
    const list = [item("OLD", { added_at: null }), item("MID", { added_at: "2026-10-18T08:00:00" }), item("NEW", { added_at: "2026-10-21T08:00:00" }), item("OLD2", { added_at: null })];

    expect(names(visibleItems(list, "all", "new"))).toEqual(["NEW", "MID", "OLD", "OLD2"]);
  });

  it("sorts by name, falling back to the ticker for a company with no name", () => {
    const list = [item("ZZZ", { name: "Zeta" }), item("AAA", { name: null }), item("MMM", { name: "Mid" })];

    expect(names(visibleItems(list, "all", "name"))).toEqual(["AAA", "MMM", "ZZZ"]);
  });

  it("puts the biggest rise first and a company with no quote last, not as a zero", () => {
    const list = [item("FLAT", { change_pct: 0 }), item("NOQ", { change_pct: null, price: null }), item("UP", { change_pct: 2.1 }), item("DOWN", { change_pct: -3 })];

    expect(names(visibleItems(list, "all", "change"))).toEqual(["UP", "FLAT", "DOWN", "NOQ"]);
  });

  it("does not change the list it is given", () => {
    const list = [item("B"), item("A")];

    visibleItems(list, "all", "name");

    expect(names(list)).toEqual(["B", "A"]);
  });
});

describe("text helpers", () => {
  it("says how long ago and where it came from, without inventing a date", () => {
    const now = Date.parse("2026-10-22T09:00:00Z");

    expect(addedText(item("A", { added_at: "2026-10-22T07:00:00" }), now)).toBe("Added today · by you");
    expect(addedText(item("A", { added_at: "2026-10-21T07:00:00" }), now)).toBe("Added 1 day ago · by you");
    expect(addedText(item("A", { added_at: "2026-10-12T07:00:00", source: "today" }), now)).toBe("Added 10 days ago · saved from Today");
    expect(addedText(item("A", { added_at: null }), now)).toBe("Added earlier · by you");
    expect(addedText(item("A", { added_at: "2026-10-23T07:00:00" }), now)).toBe("Added today · by you"); // a clock a little behind
  });

  it("joins the ticker, exchange and currency that are known", () => {
    expect(metaText(item("HLDN"))).toBe("HLDN · NASDAQ · USD");
    expect(metaText(item("HLDN", { exchange: null, currency: null }))).toBe("HLDN");
  });

  it("names the company, or the ticker until it is resolved", () => {
    expect(nameOf(item("HLDN"))).toBe("HLDN Corp");
    expect(nameOf(item("HLDN", { name: null }))).toBe("HLDN");
  });

  it("shows a price with its currency, whole for a currency without cents, and no unit when unknown", () => {
    expect(priceText({ price: 184.2, currency: "USD" })).toBe("USD 184.20");
    expect(priceText({ price: 3845, currency: "JPY" })).toBe("JPY 3,845");
    expect(priceText({ price: 12.84, currency: "GBP" })).toBe("GBP 12.84");
    expect(priceText({ price: 1284, currency: null })).toBe("1,284.00");
    expect(priceText({ price: null, currency: "USD" })).toBeNull();
    expect(priceText({ price: Number.NaN, currency: "USD" })).toBeNull();
  });
});
