"use client";

import Link from "next/link";
import { List, ListItemButton, ListItemText } from "@mui/material";
import { PageHeader } from "@/components/shell/PageHeader";

const ITEMS = [
  { label: "Track record", href: "/more/track-record", hint: "How past calls moved after 20 days" },
  { label: "Backtests", href: "/more/backtests", hint: "Test the signals on past prices" },
  { label: "Preferences", href: "/more/preferences", hint: "Risk, sectors to avoid, notes, appearance" },
  { label: "Account", href: "/more/account", hint: "Password, usage, export and delete" },
];

export default function MorePage() {
  return (
    <div>
      <PageHeader title="More" />
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
