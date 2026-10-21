import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { ArrowDownRight, ArrowUpRight, Bell, ChevronRight } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import { alertPill, missingNote, type AlertRow, type PillTone } from "@/lib/alerts";
import type { PortfolioAlerts as Typed } from "@/lib/api/alert-types";
import { AutomaticTag } from "./AutomaticTag";

// Green and red only for a price move; every other pill is neutral, and each says its kind in words.
const PILL: Record<PillTone, { color: string; bg: string; border: string }> = {
  outline: { color: "var(--text)", bg: "transparent", border: "1px solid var(--line2)" },
  muted: { color: "var(--text2)", bg: "var(--track)", border: "1px solid transparent" },
  up: { color: "var(--up)", bg: "var(--up-bg)", border: "1px solid transparent" },
  down: { color: "var(--down)", bg: "var(--down-bg)", border: "1px solid transparent" },
};

function Pill({ row }: { row: AlertRow }) {
  const { label, tone } = alertPill(row);
  const { color, bg, border } = PILL[tone];
  const Icon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : null;
  return (
    <Box
      component="span"
      sx={{ flex: "none", px: 1.5, minHeight: 28, display: "inline-flex", alignItems: "center", gap: 0.5, borderRadius: 999, color, bgcolor: bg, border, fontSize: "0.75rem", fontWeight: 500, whiteSpace: "nowrap" }}
    >
      {Icon && <Icon size={13} aria-hidden />}
      {label}
    </Box>
  );
}

/**
 * The Portfolio alerts panel: a row per thing worth a look on a holding, with its company name, one
 * sentence, a pill for its kind and a way into it. A pending call opens its analysis; earnings and
 * moves open the Portfolio page.
 */
export function PortfolioAlerts({ rows, missing = [] }: { rows: AlertRow[]; missing?: Typed["missing"] }) {
  const note = missingNote(missing);
  return (
    <Panel component="section" aria-label="Portfolio alerts" sx={{ p: "18px 20px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Bell size={16} aria-hidden />
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
          Portfolio alerts
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{rows.length} to look at</Typography>
      </Box>
      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, mt: 1 }}>
        {rows.map((row) => (
          <Box component="li" key={row.key} sx={{ borderBottom: "1px solid var(--line)", "&:last-of-type": { borderBottom: 0 } }}>
            <Box
              component={Link}
              href={row.href}
              sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.25, minHeight: 56, color: "inherit", textDecoration: "none" }}
            >
              <Logo name={row.name ?? row.ticker} size={34} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 1 }}>
                  <Typography sx={{ fontWeight: 650, fontSize: "0.8125rem" }}>{row.ticker}</Typography>
                  {row.name && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{row.name}</Typography>}
                  <AutomaticTag source={row.source} />
                </Box>
                <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)" }}>{row.text}</Typography>
              </Box>
              <Pill row={row} />
              <ChevronRight size={16} color="var(--muted)" aria-hidden />
            </Box>
          </Box>
        ))}
      </Box>
      {note && <Typography sx={{ mt: 1, fontSize: "0.75rem", color: "var(--muted)" }}>{note}</Typography>}
    </Panel>
  );
}
