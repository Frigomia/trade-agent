import { Box, type SxProps, type Theme } from "@mui/material";

/**
 * The Soft score bar: an 8px track with a rounded fill. `caution` turns the fill amber; the number
 * or word beside it always carries the meaning, so the colour is never the only cue.
 */
interface BarProps {
  value: number;
  label: string;
  /** Read instead of the bare number, e.g. "3 of 6". */
  valueText?: string;
  caution?: boolean;
  sx?: SxProps<Theme>;
}

export function Bar({ value, label, valueText, caution = false, sx }: BarProps) {
  const percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <Box
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={valueText}
      sx={[{ height: 8, borderRadius: 999, bgcolor: "var(--track)", overflow: "hidden" }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
    >
      <Box sx={{ height: "100%", width: `${percent}%`, borderRadius: 999, bgcolor: caution ? "var(--warn)" : "var(--accent-solid)" }} />
    </Box>
  );
}
