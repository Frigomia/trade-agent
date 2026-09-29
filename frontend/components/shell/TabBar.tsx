import Link from "next/link";
import { Box } from "@mui/material";
import { PHONE_TABS, type NavItem } from "./navItems";
import type { Role } from "@/lib/auth/role-stub";

export function TabBar({ role }: { role: Role }) {
  const tabs = PHONE_TABS.filter((item: NavItem) => !item.adminOnly || role === "admin");

  return (
    <Box
      component="nav"
      sx={{
        display: { xs: "flex", md: "none" },
        justifyContent: "space-around",
        borderTop: "1px solid var(--line)",
        position: "sticky",
        bottom: 0,
        background: "var(--panel)",
        backdropFilter: "blur(20px)",
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "8px 0",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span style={{ fontSize: 11 }}>{tab.label}</span>
          </Link>
        );
      })}
    </Box>
  );
}
