import { describe, it, expect } from "vitest";
import { addSector, MAX_SECTORS, SECTOR_MAX_LENGTH } from "./preferences";

describe("addSector", () => {
  it("trims and appends", () => {
    expect(addSector(["Energy"], "  Tobacco ")).toEqual(["Energy", "Tobacco"]);
  });
  it("ignores blanks and case-insensitive duplicates", () => {
    expect(addSector(["Energy"], "   ")).toEqual(["Energy"]);
    expect(addSector(["Energy"], " energy ")).toEqual(["Energy"]);
  });
  it("accepts a name of exactly the maximum length and ignores a longer one", () => {
    const longest = "x".repeat(SECTOR_MAX_LENGTH);
    expect(addSector([], longest)).toEqual([longest]);
    expect(addSector(["Energy"], longest + "y")).toEqual(["Energy"]);
  });
  it("stops adding once the list is full", () => {
    const full = Array.from({ length: MAX_SECTORS }, (_, n) => `Sector ${n}`);
    expect(addSector(full, "One more")).toEqual(full);
    expect(addSector(full.slice(1), "One more")).toHaveLength(MAX_SECTORS);
  });
});
