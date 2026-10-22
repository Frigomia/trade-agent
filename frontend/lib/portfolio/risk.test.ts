import { describe, expect, it } from "vitest";
import type { AnalyticsPosition, PortfolioAnalytics } from "@/lib/api/analytics-types";
import { correlationPairs, orderedPositions, riskFacts, spread } from "./risk";

const pos = (ticker: string, weight: number, name = `${ticker} Corp`): AnalyticsPosition => ({
  ticker,
  name,
  value_eur: weight * 10000,
  weight,
  currency: "EUR",
  price: 1,
  price_as_of: null,
  stale: false,
});

const analytics = (over: Partial<PortfolioAnalytics> = {}): PortfolioAnalytics => ({
  as_of: "2026-10-22T10:00:00Z",
  total_value_eur: 10000,
  positions: [pos("BBB", 0.25), pos("AAA", 0.5), pos("CCC", 0.15), pos("DDD", 0.1)],
  by_sector: [
    { label: "Technology", weight: 0.6 },
    { label: "Utilities", weight: 0.4 },
  ],
  by_industry: [],
  by_country: [{ label: "Japan", weight: 1 }],
  by_currency: [
    { label: "EUR", weight: 0.7 },
    { label: "USD", weight: 0.3 },
  ],
  top_position_weight: 0.5,
  hhi: 0.3725,
  effective_n: 2.68,
  volatility_annualized: 0.174,
  correlation: {
    AAA: { AAA: 1, BBB: 0.4, CCC: 0.2, DDD: null },
    BBB: { AAA: 0.4, BBB: 1, CCC: 0.6, DDD: 0.1 },
    CCC: { AAA: 0.2, BBB: 0.6, CCC: 1, DDD: 0.3 },
    DDD: { AAA: null, BBB: 0.1, CCC: 0.3, DDD: 1 },
  },
  skipped: {},
  notes: [],
  ...over,
});

describe("orderedPositions", () => {
  it("orders by weight, largest first, ties by ticker", () => {
    const list = analytics({ positions: [pos("B", 0.3), pos("A", 0.3), pos("C", 0.4)] });

    expect(orderedPositions(list).map((p) => p.ticker)).toEqual(["C", "A", "B"]);
  });
});

describe("riskFacts", () => {
  it("measures the largest position, the top three together and the spread of the weights", () => {
    const facts = riskFacts(analytics());

    expect(facts.largest).toEqual({ ticker: "AAA", name: "AAA Corp", weight: 0.5 });
    expect(facts.topThree?.tickers).toEqual(["AAA", "BBB", "CCC"]);
    expect(facts.topThree?.weight).toBeCloseTo(0.9);
    expect(facts.volatility).toBe(0.174);
    expect(facts.effectiveHoldings).toBe(2.68);
  });

  it("averages every pair once and names the most correlated pair", () => {
    const facts = riskFacts(analytics());

    // The pairs with an estimate: AB 0.4, AC 0.2, BC 0.6, BD 0.1, CD 0.3 (AD is unknown).
    expect(facts.averageCorrelation).toBeCloseTo((0.4 + 0.2 + 0.6 + 0.1 + 0.3) / 5);
    expect(facts.highestPair).toEqual({ a: "BBB", b: "CCC", value: 0.6 });
  });

  it("has no top three with fewer than three holdings, because it would just be everything", () => {
    const facts = riskFacts(analytics({ positions: [pos("AAA", 0.6), pos("BBB", 0.4)] }));

    expect(facts.topThree).toBeNull();
    expect(facts.largest?.ticker).toBe("AAA");
  });

  it("leaves a figure null when the backend could not compute it, never zero", () => {
    const facts = riskFacts(analytics({ volatility_annualized: null, effective_n: null, correlation: {}, positions: [pos("AAA", 1)] }));

    expect(facts.volatility).toBeNull();
    expect(facts.effectiveHoldings).toBeNull();
    expect(facts.averageCorrelation).toBeNull();
    expect(facts.highestPair).toBeNull();
  });

  it("ignores a non-finite number", () => {
    const facts = riskFacts(analytics({ volatility_annualized: Number.NaN, effective_n: Number.POSITIVE_INFINITY }));

    expect(facts.volatility).toBeNull();
    expect(facts.effectiveHoldings).toBeNull();
  });

  it("is empty for no positions", () => {
    const facts = riskFacts(analytics({ positions: [], total_value_eur: null, correlation: {} }));

    expect(facts.largest).toBeNull();
    expect(facts.topThree).toBeNull();
  });
});

describe("correlationPairs", () => {
  it("lists each pair once, in the weight order, skipping unknown and non-finite values", () => {
    const list = analytics({ correlation: { AAA: { BBB: 0.4, CCC: Number.NaN, DDD: null }, BBB: { CCC: 0.6 } } });

    expect(correlationPairs(list)).toEqual([
      { a: "AAA", b: "BBB", value: 0.4 },
      { a: "BBB", b: "CCC", value: 0.6 },
    ]);
  });

  it("can hold a negative correlation", () => {
    const list = analytics({ positions: [pos("A", 0.5), pos("B", 0.5)], correlation: { A: { B: -0.3 } } });

    expect(correlationPairs(list)).toEqual([{ a: "A", b: "B", value: -0.3 }]);
    expect(riskFacts(list).averageCorrelation).toBeCloseTo(-0.3);
  });
});

describe("spread", () => {
  it("counts the sectors, countries and currencies and names the largest sector", () => {
    expect(spread(analytics())).toEqual({ sectors: 2, countries: 1, currencies: 2, largestSector: { label: "Technology", weight: 0.6 }, unclassifiedSector: null });
  });

  it("does not count Unclassified as a sector, country or currency, or name it the largest sector", () => {
    const result = spread(
      analytics({
        by_sector: [
          { label: "Unclassified", weight: 0.5 },
          { label: "Technology", weight: 0.3 },
          { label: "Utilities", weight: 0.2 },
        ],
        by_country: [{ label: "Unclassified", weight: 1 }],
        by_currency: [{ label: "EUR", weight: 1 }],
      }),
    );

    expect(result).toEqual({ sectors: 2, countries: 0, currencies: 1, largestSector: { label: "Technology", weight: 0.3 }, unclassifiedSector: 0.5 });
  });

  it("has no largest sector when nothing is classified", () => {
    expect(spread(analytics({ by_sector: [] })).largestSector).toBeNull();
  });
});
