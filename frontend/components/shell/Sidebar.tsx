"use client";

import Link from "next/link";
import { Box, List, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import { DESKTOP_SECTIONS, type NavItem } from "./navItems";
import type { Role } from "@/lib/auth/role-stub";

export function Sidebar({ role }: { role: Role }) {
  const items = DESKTOP_SECTIONS.filter((item: NavItem) => !item.adminOnly || role === "admin");

  return (
    <Box
      component="nav"
      sx={{
        width: 218,
        borderRight: "1px solid var(--line)",
        display: { xs: "none", md: "block" },
      }}
    >
      <List>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <ListItemButton key={item.href} component={Link} href={item.href}>
              <ListItemIcon>
                <Icon size={18} strokeWidth={1.75} />
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
