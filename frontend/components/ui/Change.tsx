import { Box } from "@mui/material";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatPct } from "@/lib/format";

/**
 * A price change: sign, arrow and colour together, decided from the value as displayed (one
 * decimal), so a move that rounds to zero is shown flat and neutral rather than as a red fall.
 * This is the only place green and red appear on Today.
 */
export function Change({ pct }: { pct: number }) {
  const shown = Number(pct.toFixed(1));
  const Icon = shown < 0 ? ArrowDownRight : ArrowUpRight;
  const color = shown === 0 ? "var(--muted)" : shown < 0 ? "var(--down)" : "var(--up)";
  return (
    <Box
      component="span"
      sx={{ display: "inline-flex", alignItems: "center", gap: "2px", fontWeight: 650, fontVariantNumeric: "tabular-nums", color }}
    >
      {formatPct(pct)}
      {shown !== 0 && <Icon size={13} aria-hidden />}
    </Box>
  );
}
