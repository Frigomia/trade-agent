import { AlertTriangle, Check } from "lucide-react";
import { Chip } from "@mui/material";

const TINT_BORDER = "color-mix(in srgb, currentColor 22%, transparent)";
// A tinted pill with an icon and the word (never colour alone); "Not connected" is a quiet outline.
const CHIP = {
  ok: { label: "Connected", color: "var(--accent)", bg: "var(--accent-wash)", border: TINT_BORDER, icon: <Check size={13} aria-hidden /> },
  warn: { label: "Needs attention", color: "var(--warn)", bg: "var(--warn-bg)", border: TINT_BORDER, icon: <AlertTriangle size={13} aria-hidden /> },
  none: { label: "Not connected", color: "var(--muted)", bg: "transparent", border: "var(--line2)", icon: undefined },
  server: { label: "Server key", color: "var(--accent)", bg: "var(--accent-wash)", border: TINT_BORDER, icon: <Check size={13} aria-hidden /> },
} as const;

export type ClaudeChipKind = keyof typeof CHIP;

/** The Claude connection status chip, shared by Account and the admin Users list. */
export function ClaudeStateChip({ kind }: { kind: ClaudeChipKind }) {
  const chip = CHIP[kind];
  return (
    <Chip
      size="small"
      label={chip.label}
      icon={chip.icon}
      variant="outlined"
      sx={{ color: chip.color, borderColor: chip.border, bgcolor: chip.bg, fontWeight: 600, "& .MuiChip-icon": { color: "inherit", ml: 1, mr: -0.5 } }}
    />
  );
}

/**
 * Maps the admin API's key state onto the chip kind. An admin without a personal key still uses
 * Claude (on the server key), so that row reads "Server key" rather than "Not connected".
 */
export const chipKind = (state: "none" | "ok" | "needs_attention", role?: string): ClaudeChipKind =>
  state === "needs_attention" ? "warn" : state === "none" && role === "admin" ? "server" : state;
