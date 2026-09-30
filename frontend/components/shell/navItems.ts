import type { LucideIcon } from "lucide-react";
import {
  ChartPie,
  History,
  ListChecks,
  MessageSquare,
  Shield,
  SlidersHorizontal,
  SquareCheckBig,
  UserRound,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

// Icons follow the mockups: a checked square for Today, a pie for Portfolio, a speech bubble for
// Chat, sliders for the secondary sections.
export const PHONE_TABS: NavItem[] = [
  { label: "Today", href: "/today", icon: SquareCheckBig },
  { label: "Portfolio", href: "/portfolio", icon: ChartPie },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "More", href: "/more", icon: SlidersHorizontal },
  { label: "Admin", href: "/admin", icon: Shield, adminOnly: true },
];

export const DESKTOP_SECTIONS: NavItem[] = [
  { label: "Today", href: "/today", icon: SquareCheckBig },
  { label: "Portfolio", href: "/portfolio", icon: ChartPie },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Track record", href: "/more/track-record", icon: ListChecks },
  { label: "Backtests", href: "/more/backtests", icon: History },
  { label: "Preferences", href: "/more/preferences", icon: SlidersHorizontal },
  { label: "Account", href: "/more/account", icon: UserRound },
  { label: "Admin", href: "/admin", icon: Shield, adminOnly: true },
];

/** True when `pathname` is this item's section (the item itself or one of its sub-pages). */
export function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
