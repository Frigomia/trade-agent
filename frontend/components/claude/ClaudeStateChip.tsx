import { Chip } from "@mui/material";

const CHIP = {
  ok: { label: "Connected", color: "var(--up)", bg: "var(--up-bg)" },
  warn: { label: "Needs attention", color: "var(--warn)", bg: "var(--warn-bg)" },
  none: { label: "Not connected", color: "var(--muted)", bg: "transparent" },
  server: { label: "Server key", color: "var(--up)", bg: "var(--up-bg)" },
} as const;

export type ClaudeChipKind = keyof typeof CHIP;

/** The Claude connection status chip, shared by Account and the admin Users list. */
export function ClaudeStateChip({ kind }: { kind: ClaudeChipKind }) {
  const chip = CHIP[kind];
  return (
    <Chip
      size="small"
      label={chip.label}
      variant="outlined"
      sx={{ color: chip.color, borderColor: chip.color, bgcolor: chip.bg, fontWeight: 600 }}
    />
  );
}

/**
 * Maps the admin API's key state onto the chip kind. An admin without a personal key still uses
 * Claude (on the server key), so that row reads "Server key" rather than "Not connected".
 */
export const chipKind = (state: "none" | "ok" | "needs_attention", role?: string): ClaudeChipKind =>
  state === "needs_attention" ? "warn" : state === "none" && role === "admin" ? "server" : state;
