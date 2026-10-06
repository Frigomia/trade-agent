"use client";

import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { AlertTriangle, KeyRound } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { ClaudeLock } from "@/lib/claudeKey";

const COPY = {
  chat: {
    connect: {
      title: "Connect Claude to use Chat",
      text: "Chat and analysis run on your own Claude account. Setting it up takes about five minutes, once.",
      cta: "Connect Claude",
    },
    reconnect: {
      title: "Your Claude key needs attention",
      text: "Anthropic did not accept your key. It may have been revoked, or the account may be out of credit.",
      cta: "Reconnect",
    },
  },
  today: {
    connect: {
      title: "Connect Claude to start analyzing",
      text: "Run analysis and Chat use your own Claude account. About five minutes, once.",
      cta: "Set up",
    },
    reconnect: {
      title: "Your Claude key needs attention",
      text: "Anthropic did not accept your key. It may have been revoked, or the account may be out of credit.",
      cta: "Reconnect",
    },
  },
} as const;

/** The locked-state card: compact in Chat's composer slot, a reminder at the top of Today. */
export function ClaudeRequired({ variant, lock }: { variant: "chat" | "today"; lock: NonNullable<ClaudeLock> }) {
  const { title, text, cta } = COPY[variant][lock];
  const warn = lock === "reconnect";
  const Icon = warn ? AlertTriangle : KeyRound;
  return (
    <Panel
      sx={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 1.5,
        p: "12px 14px",
        mb: variant === "today" ? 1.5 : 0,
        ...(warn && { borderColor: "var(--warn)", bgcolor: "var(--warn-bg)" }),
      }}
    >
      <Box
        aria-hidden
        sx={{ display: "grid", placeItems: "center", flex: "none", color: warn ? "var(--warn)" : "var(--accent)" }}
      >
        <Icon size={20} />
      </Box>
      <Box sx={{ flex: "1 1 220px", minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 650 }}>{title}</Typography>
        <Typography sx={{ fontSize: 12.5, color: "var(--muted)", mt: 0.25 }}>{text}</Typography>
      </Box>
      <Button component={Link} href="/more/connect-claude" variant={warn ? "outlined" : "contained"} size="small">
        {cta}
      </Button>
    </Panel>
  );
}
