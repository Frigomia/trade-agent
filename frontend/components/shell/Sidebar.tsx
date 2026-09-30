"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Typography } from "@mui/material";
import { DESKTOP_SECTIONS, isActive, type NavItem } from "./navItems";
import { BrandMark } from "@/components/auth/AuthShell";
import { Panel } from "@/components/ui/Panel";
import type { Role } from "@/lib/auth/session";

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = DESKTOP_SECTIONS.filter((item: NavItem) => !item.adminOnly || role === "admin");

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={{
        width: 210,
        flex: "none",
        borderRight: "1px solid var(--line)",
        display: { xs: "none", md: "flex" },
        flexDirection: "column",
        gap: 0.5,
        p: "22px 14px",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 1, pb: 2 }}>
        <BrandMark size={34} />
        <Typography sx={{ fontSize: 16, fontWeight: 650, letterSpacing: "-0.01em" }}>
          trade-agent
        </Typography>
      </Box>
      {items.map((item) => {
        const Icon = item.icon;
        const on = isActive(pathname, item.href, item.exact);
        return (
          <Fragment key={item.href}>
            {item.section && (
              <Typography sx={{ fontSize: 12, color: "var(--muted)", px: 1.5, pt: 2, pb: 0.5 }}>
                {item.section}
              </Typography>
            )}
          <Link
            href={item.href}
            aria-current={on ? "page" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: on ? 600 : 400,
              textDecoration: "none",
              color: on ? "var(--accent)" : "var(--muted)",
              background: on ? "var(--up-bg)" : "transparent",
            }}
          >
            <Icon size={18} strokeWidth={1.75} />
            {item.label}
          </Link>
          </Fragment>
        );
      })}
      <Box sx={{ flex: 1 }} />
      <Panel sx={{ p: "12px 14px" }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>Advisory only</Typography>
        <Typography sx={{ fontSize: 12, color: "var(--muted)", mt: 0.25 }}>
          Nothing here places a trade.
        </Typography>
      </Panel>
    </Box>
  );
}
