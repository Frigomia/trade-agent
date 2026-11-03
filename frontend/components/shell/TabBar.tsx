"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Box } from "@mui/material";
import { PHONE_TABS, isActive, type NavItem } from "./navItems";
import type { Role } from "@/lib/auth/session";

export function TabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = PHONE_TABS.filter((item: NavItem) => !item.adminOnly || role === "admin");
  const ref = useRef<HTMLElement>(null);

  // Publish the bar's real height (it changes with the font and the safe-area inset) so a screen can
  // pin something right above it, as the chat composer does, without guessing a number.
  useEffect(() => {
    const bar = ref.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--tabbar-h", `${bar.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--tabbar-h");
    };
  }, []);

  return (
    <Box
      component="nav"
      ref={ref}
      aria-label="Main"
      sx={{
        display: { xs: "flex", md: "none" },
        justifyContent: "space-around",
        borderTop: "1px solid var(--line)",
        position: "sticky",
        bottom: 0,
        px: 1,
        pt: 1,
        pb: "calc(8px + env(safe-area-inset-bottom, 0px))",
        zIndex: 10,
        background: "var(--tab-bg)",
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const on = isActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              minWidth: 0,
              minHeight: 48,
              flex: 1,
              justifyContent: "center",
              color: on ? "var(--accent)" : "var(--muted)",
              textDecoration: "none",
            }}
          >
            <Icon size={20} strokeWidth={1.75} aria-hidden />
            <span style={{ fontSize: "0.75rem", fontWeight: on ? 600 : 400 }}>{tab.label}</span>
          </Link>
        );
      })}
    </Box>
  );
}
