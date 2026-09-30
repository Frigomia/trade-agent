"use client";

import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { ChevronRight } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
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
      <Panel sx={{ p: "4px 18px" }}>
        {ITEMS.map((item) => (
          <Box
            key={item.href}
            component={Link}
            href={item.href}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              py: 1.75,
              color: "var(--text)",
              textDecoration: "none",
              borderBottom: "1px solid var(--line)",
              "&:last-of-type": { borderBottom: 0 },
            }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{item.label}</Typography>
              <Typography sx={{ fontSize: 12.5, color: "var(--muted)" }}>{item.hint}</Typography>
            </Box>
            <ChevronRight size={18} color="var(--muted)" />
          </Box>
        ))}
      </Panel>
    </div>
  );
}
