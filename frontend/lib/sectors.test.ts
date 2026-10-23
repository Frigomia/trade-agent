import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Cpu, HeartPulse, Layers, ShoppingBasket } from "lucide-react";
import { getSectorIcon, SECTOR_ICONS } from "./sectors";
import sectorCatalog from "./sectors.json";

describe("getSectorIcon", () => {
  it("matches the backend sector catalog and covers every sector with an icon", () => {
    const backendCatalog: unknown = JSON.parse(readFileSync("../backend/app/sectors.json", "utf8"));
    expect(sectorCatalog).toEqual(backendCatalog);
    expect(Object.keys(SECTOR_ICONS).sort()).toEqual(Object.keys(sectorCatalog).sort());
  });
  it("distinguishes defensive consumer businesses from technology", () => {
    expect(getSectorIcon("Consumer Defensive")).toBe(ShoppingBasket);
    expect(getSectorIcon(" Technology ")).toBe(Cpu);
    expect(new Set(Object.values(SECTOR_ICONS)).size).toBe(11);
  });

  it("covers the alternate sector labels used by the design mocks", () => {
    expect(getSectorIcon("Software")).toBe(Cpu);
    expect(getSectorIcon("Health Care")).toBe(HeartPulse);
    expect(getSectorIcon(" Consumer   Staples ")).toBe(ShoppingBasket);
  });

  it.each([null, undefined, "", "New provider sector", "toString", "__proto__"])(
    "uses the generic icon for an unknown or missing sector: %s",
    (sector) => expect(getSectorIcon(sector)).toBe(Layers),
  );
});
