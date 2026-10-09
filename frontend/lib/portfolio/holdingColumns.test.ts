import { describe, it, expect } from "vitest";
import * as columns from "./holdingColumns";
import { HOLDING_COLUMNS } from "./holdingColumns";

// Splits a grid-template on spaces outside parentheses, so `minmax(0, 1.2fr)` stays one track.
const tracks = (t: string) => t.split(/ (?![^(]*\))/);

describe("holding columns", () => {
  it("never uses a bare fr track, which would grow to its content and overflow the panel", () => {
    for (const template of Object.values(HOLDING_COLUMNS)) {
      for (const t of tracks(template)) expect(t).toMatch(/^(minmax\(0, [\d.]+fr\)|auto)$/);
    }
  });

  it("has six tracks from md, no wider variant, and no Avg cost display switch", () => {
    expect(tracks(HOLDING_COLUMNS.md)).toHaveLength(6);
    expect(Object.keys(HOLDING_COLUMNS)).toEqual(["xs", "md"]);
    expect(columns).not.toHaveProperty("AVG_COST_DISPLAY");
  });
});
