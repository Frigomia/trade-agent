import type { LucideIcon } from "lucide-react";
import { Home, PieChart, MessageCircle, MoreHorizontal, Shield, SlidersHorizontal, History, UserRound } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const PHONE_TABS: NavItem[] = [
  { label: "Today", href: "/today", icon: Home },
  { label: "Portfolio", href: "/portfolio", icon: PieChart },
  { label: "Chat", href: "/chat", icon: MessageCircle },
  { label: "More", href: "/more", icon: MoreHorizontal },
  { label: "Admin", href: "/admin", icon: Shield, adminOnly: true },
];

export const DESKTOP_SECTIONS: NavItem[] = [
  { label: "Today", href: "/today", icon: Home },
  { label: "Portfolio", href: "/portfolio", icon: PieChart },
  { label: "Chat", href: "/chat", icon: MessageCircle },
  { label: "Preferences", href: "/more/preferences", icon: SlidersHorizontal },
  { label: "Backtests", href: "/more/backtests", icon: History },
  { label: "Account", href: "/more/account", icon: UserRound },
  { label: "Admin", href: "/admin", icon: Shield, adminOnly: true },
];
