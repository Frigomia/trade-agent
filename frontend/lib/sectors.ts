import {
  Building2, Cpu, Factory, Fuel, HeartPulse, Landmark, Layers,
  Pickaxe, Radio, ShoppingBag, ShoppingBasket, Zap, type LucideIcon,
} from "lucide-react";

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
} satisfies Record<string, LucideIcon>;

export type Sector = keyof typeof SECTOR_ICONS;

/** API sectors stay strings: older or unknown provider values keep a generic icon. */
export function getSectorIcon(sector: string | null | undefined): LucideIcon {
  const name = sector?.trim() ?? "";
  return Object.hasOwn(SECTOR_ICONS, name) ? SECTOR_ICONS[name as Sector] : Layers;
}
