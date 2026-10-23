import { describe, expect, it } from "vitest";
import { Cpu, Layers, ShoppingBasket } from "lucide-react";
import { getSectorIcon, SECTOR_ICONS } from "./sectors";

describe("getSectorIcon", () => {
  it("distinguishes defensive consumer businesses from technology", () => {
    expect(getSectorIcon("Consumer Defensive")).toBe(ShoppingBasket);
    expect(getSectorIcon(" Technology ")).toBe(Cpu);
    expect(new Set(Object.values(SECTOR_ICONS)).size).toBe(11);
  });

  it.each([null, undefined, "", "Software", "toString", "__proto__"])(
    "uses the generic icon for an unknown or missing sector: %s",
    (sector) => expect(getSectorIcon(sector)).toBe(Layers),
  );
});
