import { describe, it, expect } from "vitest";
import { effectiveTarget, fractionToPercentText, percentTextToFraction } from "./targetWeight";

describe("effectiveTarget", () => {
  const watch = [
    { ticker: "AAPL", target_weight: 0.05 },
    { ticker: "MSFT", target_weight: null },
  ];
  it("prefers the holding's own target", () => {
    expect(effectiveTarget({ ticker: "AAPL", target_weight: 0.2 }, watch)).toEqual({ target: 0.2, fromWatchlist: false });
  });
  it("falls back to the watchlist target for the same ticker, as the backend does", () => {
    expect(effectiveTarget({ ticker: "aapl", target_weight: null }, watch)).toEqual({ target: 0.05, fromWatchlist: true });
    expect(effectiveTarget({ ticker: "AAPL", target_weight: 0 }, watch)).toEqual({ target: 0.05, fromWatchlist: true });
  });
  it("is null when neither has a target above 0", () => {
    expect(effectiveTarget({ ticker: "MSFT", target_weight: null }, watch)).toBeNull();
    expect(effectiveTarget({ ticker: "KO", target_weight: 0 }, [])).toBeNull();
  });
});

describe("target weight conversion", () => {
  it("shows a saved fraction as a percentage", () => {
    expect(fractionToPercentText(0.072)).toBe("7.2");
    expect(fractionToPercentText(0.2)).toBe("20");
    expect(fractionToPercentText(null)).toBe("");
  });
  it("stores a percentage as a fraction, blank as null", () => {
    expect(percentTextToFraction("7.2")).toBe(0.072);
    expect(percentTextToFraction("100")).toBe(1);
    expect(percentTextToFraction("0")).toBe(0);
    expect(percentTextToFraction("  ")).toBeNull();
  });
  it("converts without float noise", () => {
    expect(percentTextToFraction("7")).toBe(0.07);
    expect(percentTextToFraction("29")).toBe(0.29);
    expect(percentTextToFraction("33.33")).toBe(0.3333);
    expect(fractionToPercentText(0.07)).toBe("7");
    expect(fractionToPercentText(0.29)).toBe("29");
    expect(fractionToPercentText(0.3333)).toBe("33.33");
  });
  it("rejects out of range and too many decimals", () => {
    for (const bad of ["100.01", "-1", "abc", "1.234"]) expect(percentTextToFraction(bad)).toBeUndefined();
  });
});
