import { describe, it, expect } from "vitest";
import { AVG_COST_DISPLAY, HOLDING_COLUMNS } from "./holdingColumns";

describe("holding columns", () => {
  it("never uses a bare fr track, which would grow to its content and overflow the panel", () => {
    for (const template of Object.values(HOLDING_COLUMNS)) {
      for (const t of template.split(/ (?![^(]*\))/)) expect(t).toMatch(/^(minmax\(0, [\d.]+fr\)|auto)$/);
    }
  });

  it("has a seventh track exactly where Avg cost is shown", () => {
    const count = (t: string) => t.split(/ (?![^(]*\))/).length;
    expect(count(HOLDING_COLUMNS.md)).toBe(6);
    expect(count(HOLDING_COLUMNS.xl)).toBe(7);
    expect(AVG_COST_DISPLAY.xl).toBe("block");
  });
});
