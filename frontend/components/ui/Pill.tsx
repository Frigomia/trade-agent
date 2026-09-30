import type { ReactNode } from "react";
import { Box } from "@mui/material";

export type PillTone = "up" | "down" | "warn" | "mute";

const TONES: Record<PillTone, { color: string; bg: string }> = {
  up: { color: "var(--up)", bg: "var(--up-bg)" },
  down: { color: "var(--down)", bg: "var(--down-bg)" },
  warn: { color: "var(--warn)", bg: "var(--warn-bg)" },
  mute: { color: "var(--muted)", bg: "var(--track)" },
};

/** The mockups' `.pill`: a small rounded status or change marker. Always carries text or a sign. */
export function Pill({ tone = "mute", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        fontSize: 12,
        fontWeight: 600,
        px: 1,
        py: "2px",
        borderRadius: 999,
        fontVariantNumeric: "tabular-nums",
        color: TONES[tone].color,
        bgcolor: TONES[tone].bg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Box>
  );
}
