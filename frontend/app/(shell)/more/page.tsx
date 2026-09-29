"use client";

import Link from "next/link";
import { List, ListItemButton, ListItemText } from "@mui/material";

export default function MorePage() {
  return (
    <div>
      <h1>More</h1>
      <p style={{ color: "var(--text2)" }}>Coming in sub-project 8.</p>
      <List>
        <ListItemButton component={Link} href="/more/preferences">
          <ListItemText primary="Preferences" />
        </ListItemButton>
        <ListItemButton component={Link} href="/more/backtests">
          <ListItemText primary="Backtests" />
        </ListItemButton>
        <ListItemButton component={Link} href="/more/account">
          <ListItemText primary="Account" />
        </ListItemButton>
      </List>
    </div>
  );
}
