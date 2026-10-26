import { describe, expect, it } from "vitest";
import { remFromPx } from "./rem";

describe("remFromPx", () => {
  it("divides by the 16px default", () => {
    expect(remFromPx(16)).toBe("1rem");
    expect(remFromPx(13)).toBe("0.8125rem");
    expect(remFromPx(14.5)).toBe("0.90625rem");
  });
});
