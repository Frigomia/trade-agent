import { describe, it, expect } from "vitest";
import { fractionToPercentText, percentTextToFraction } from "./targetWeight";

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
  it("rejects out of range and too many decimals", () => {
    for (const bad of ["100.01", "-1", "abc", "1.234"]) expect(percentTextToFraction(bad)).toBeUndefined();
  });
});
