"use client";

import Link from "next/link";
import { List, ListItemButton, ListItemText, Typography } from "@mui/material";

const ITEMS = [
  { label: "Track record", href: "/more/track-record", hint: "How past calls moved after 20 days" },
  { label: "Backtests", href: "/more/backtests", hint: "Test the signals on past prices" },
  { label: "Preferences", href: "/more/preferences", hint: "Risk, sectors to avoid, notes, appearance" },
  { label: "Account", href: "/more/account", hint: "Password, usage, export and delete" },
];

export default function MorePage() {
  return (
    <div>
      <Typography variant="h5" sx={{ fontWeight: 650, mb: 1 }}>
        More
      </Typography>
      <List>
        {ITEMS.map((item) => (
          <ListItemButton key={item.href} component={Link} href={item.href}>
            <ListItemText primary={item.label} secondary={item.hint} />
          </ListItemButton>
        ))}
      </List>
    </div>
  );
}
