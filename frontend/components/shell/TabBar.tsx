"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box } from "@mui/material";
import { PHONE_TABS, isActive, type NavItem } from "./navItems";
import type { Role } from "@/lib/auth/session";

export function TabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = PHONE_TABS.filter((item: NavItem) => !item.adminOnly || role === "admin");

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={{
        display: { xs: "flex", md: "none" },
        justifyContent: "space-around",
        borderTop: "1px solid var(--line)",
        position: "sticky",
        bottom: 0,
        p: "10px 6px 16px",
        background: "var(--tab-bg)",
        backdropFilter: "blur(20px)",
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
              minWidth: 56,
              color: on ? "var(--accent)" : "var(--muted)",
              textDecoration: "none",
            }}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span style={{ fontSize: 11, fontWeight: on ? 600 : 400 }}>{tab.label}</span>
          </Link>
        );
      })}
    </Box>
  );
}
