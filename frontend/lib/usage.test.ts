import { describe, it, expect } from "vitest";
import { nextResetDate, usageFraction, usageLevel } from "./usage";

describe("usage", () => {
  it("resets on the first of next month, UTC, across a year boundary", () => {
    expect(nextResetDate(new Date("2026-12-15T10:00:00Z"))).toBe("2027-01-01");
    expect(nextResetDate(new Date("2026-09-30T23:59:59Z"))).toBe("2026-10-01");
  });
  it("clamps the fraction and survives a zero or exceeded limit", () => {
    expect(usageFraction({ used: 5, limit: 10 })).toBe(0.5);
    expect(usageFraction({ used: 15, limit: 10 })).toBe(1);
    expect(usageFraction({ used: 3, limit: 0 })).toBe(0);
  });
  it("classifies ok, warn above 90 percent, and limit", () => {
    expect(usageLevel({ used: 9, limit: 10 })).toBe("ok");
    expect(usageLevel({ used: 10, limit: 11 })).toBe("warn");
    expect(usageLevel({ used: 10, limit: 10 })).toBe("limit");
    expect(usageLevel({ used: 12, limit: 10 })).toBe("limit");
    expect(usageLevel({ used: 1, limit: 0 })).toBe("ok");
  });
});
