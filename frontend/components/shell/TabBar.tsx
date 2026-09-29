import Link from "next/link";
import { Box } from "@mui/material";
import { PHONE_TABS } from "./navItems";
import type { Role } from "@/lib/auth/role-stub";

// role kept in the signature so a later sub-project can add a phone-only admin affordance
// without changing every call site.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function TabBar({ role }: { role: Role }) {
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
      {PHONE_TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0" }}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span style={{ fontSize: 11 }}>{tab.label}</span>
          </Link>
        );
      })}
    </Box>
  );
}
