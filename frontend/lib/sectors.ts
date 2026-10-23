import {
  Building2, Cpu, Factory, Fuel, HeartPulse, Landmark, Layers,
  Pickaxe, Radio, ShoppingBag, ShoppingBasket, Zap, type LucideIcon,
} from "lucide-react";
import sectorCatalog from "./sectors.json";

export type Sector = keyof typeof sectorCatalog;

/** Sector names used by the discovery universe and market-data provider. */
export const SECTOR_ICONS = {
  "Basic Materials": Pickaxe,
  "Communication Services": Radio,
  "Consumer Cyclical": ShoppingBag,
  "Consumer Defensive": ShoppingBasket,
  Energy: Fuel,
  "Financial Services": Landmark,
  Healthcare: HeartPulse,
  Industrials: Factory,
  "Real Estate": Building2,
  Technology: Cpu,
  Utilities: Zap,
} satisfies Record<Sector, LucideIcon>;

const sectorAliases = new Map<string, Sector>();
for (const name of Object.keys(sectorCatalog) as Sector[]) {
  for (const alias of [name, ...sectorCatalog[name]]) {
    sectorAliases.set(alias.toLowerCase(), name);
  }
}

/** API sectors stay strings: older or unknown provider values keep a generic icon. */
export function getSectorIcon(sector: string | null | undefined): LucideIcon {
  const name = sectorAliases.get(sector?.trim().replace(/\s+/g, " ").toLowerCase() ?? "");
  return name ? SECTOR_ICONS[name] : Layers;
}
