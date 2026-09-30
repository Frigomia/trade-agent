import { describe, it, expect } from "vitest";
import { addSector } from "./preferences";

describe("addSector", () => {
  it("trims and appends", () => {
    expect(addSector(["Energy"], "  Tobacco ")).toEqual(["Energy", "Tobacco"]);
  });
  it("ignores blanks and case-insensitive duplicates", () => {
    expect(addSector(["Energy"], "   ")).toEqual(["Energy"]);
    expect(addSector(["Energy"], " energy ")).toEqual(["Energy"]);
  });
});
