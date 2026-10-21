import { describe, expect, it } from "vitest";
import { priceText, priceToText, rangeText, textsToRange } from "./priceRange";

describe("textsToRange", () => {
  it("is null when both fields are blank, which means no range", () => {
    expect(textsToRange("", "")).toBeNull();
    expect(textsToRange("  ", " ")).toBeNull();
  });

  it("reads two prices, with a comma or up to six decimals", () => {
    expect(textsToRange("90", "110.5")).toEqual({ low: 90, high: 110.5 });
    expect(textsToRange("0,5", "1")).toEqual({ low: 0.5, high: 1 });
    expect(textsToRange("0.000001", "0.000002")).toEqual({ low: 0.000001, high: 0.000002 });
    expect(textsToRange("100", "100")).toEqual({ low: 100, high: 100 });
  });

  it("is undefined for one blank end, a non-price, zero, too many decimals or low above high", () => {
    for (const [low, high] of [["90", ""], ["", "110"], ["a", "5"], ["5", "-1"], ["0", "5"], ["1.0000001", "2"], ["120", "100"], ["1", "1000000000000"]]) {
      expect(textsToRange(low, high), `${low} / ${high}`).toBeUndefined();
    }
  });
});

describe("range text helpers", () => {
  it("shows a saved price as the text of its field, empty when there is none", () => {
    expect(priceToText(90.5)).toBe("90.5");
    expect(priceToText(null)).toBe("");
    expect(priceToText(undefined)).toBe("");
  });

  it("shows a price with its own decimals, not rounded to two", () => {
    expect(priceText(98.4)).toBe("98.4");
    expect(priceText(15250)).toBe("15,250");
    expect(priceText(0.000123)).toBe("0.000123");
  });

  it("words a saved range, or nothing when either end is missing", () => {
    expect(rangeText({ target_price_low: 90, target_price_high: 110 })).toBe("90 to 110");
    expect(rangeText({ target_price_low: null, target_price_high: null })).toBeNull();
    expect(rangeText({})).toBeNull();
  });
});
