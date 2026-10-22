import { describe, expect, it } from "vitest";
import type { CandidateFit } from "@/lib/api/discovery-types";
import { fitAssumption, fitFacts } from "./fitFacts";

const fit = (over: Partial<CandidateFit> = {}): CandidateFit => ({
  ticker: "HLDN",
  applicable: true,
  avg_correlation_to_portfolio: 0.314,
  portfolio_vol_before: 0.124,
  portfolio_vol_after: 0.118,
  hhi_before: 0.2,
  hhi_after: 0.186,
  sector_weight_before: 0.03,
  sector_weight_after: 0.07,
  hypothetical_weight: 0.05,
  notes: [],
  ...over,
});

describe("fitFacts", () => {
  it("gives each figure as a before and after, named for the sector when it is known", () => {
    const facts = Object.fromEntries(fitFacts(fit(), "Software").map((f) => [f.label, f.value]));

    expect(facts).toEqual({
      "Software weight": "3% → 7%",
      Concentration: "0.20 → 0.19",
      "Portfolio volatility": "12.4% → 11.8%",
      "Correlation with your holdings": "0.31",
    });
  });

  it("falls back to a plain label with no sector, and adds a decimal when rounding would hide a change", () => {
    const facts = fitFacts(fit({ sector_weight_before: 0.031, sector_weight_after: 0.034 }), null);

    expect(facts[0]).toMatchObject({ label: "Sector weight", value: "3.1% → 3.4%" });
    expect(fitFacts(fit({ sector_weight_before: 0.03, sector_weight_after: 0.03 }), null)[0].value).toBe("3% → 3%");
  });

  it("leaves out a figure that is missing or not finite, never a made-up zero", () => {
    const facts = fitFacts(
      fit({ hhi_before: null, portfolio_vol_after: Number.NaN, avg_correlation_to_portfolio: null }),
      "Software",
    );

    expect(facts.map((f) => f.label)).toEqual(["Software weight"]);
  });

  it("marks nothing good or bad: the details are neutral wording", () => {
    for (const f of fitFacts(fit(), "Software")) expect(f.detail).not.toMatch(/\b(good|bad|better|worse|risky)\b/i);
  });
});

describe("a correlation near zero", () => {
  it("never reads as negative zero", () => {
    const value = (r: number) => fitFacts(fit({ avg_correlation_to_portfolio: r }), null).find((f) => f.label.startsWith("Correlation"))!.value;

    expect(value(-0.004)).toBe("0.00");
    expect(value(-0.31)).toBe("-0.31");
  });

  it("says the average is weighted by position size", () => {
    const f = fitFacts(fit(), null).find((x) => x.label.startsWith("Correlation"))!;
    expect(f.detail).toMatch(/by their weight/);
  });
});

describe("fitAssumption", () => {
  it("does not print NaN when the assumed weight is missing", () => {
    const text = fitAssumption(fit({ hypothetical_weight: Number.NaN }));

    expect(text).not.toMatch(/NaN|undefined/);
    expect(text).toMatch(/not a recommendation/);
  });

  it("states the assumed weight and that it is not a recommendation", () => {
    expect(fitAssumption(fit())).toMatch(/at 5% of your portfolio/);
    expect(fitAssumption(fit({ hypothetical_weight: 0.075 }))).toMatch(/at 7\.5% of your portfolio/);
    expect(fitAssumption(fit())).toMatch(/not a recommendation/);
  });
});
