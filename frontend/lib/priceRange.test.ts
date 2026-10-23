import { describe, expect, it } from "vitest";
import { priceToText, textsToRange } from "./priceRange";

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
});
