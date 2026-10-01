import { Box, Typography } from "@mui/material";
import { usageFraction, usageLevel, type UsageDetail } from "@/lib/usage";

/** The quiet "44 / 100" chat allowance with a thin bar; it turns amber near and at the limit. */
export function UsageMeter({ usage }: { usage: UsageDetail }) {
  const color = usageLevel(usage) === "ok" ? "var(--accent)" : "var(--warn)";
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1 }} title="Chat messages used this month">
      <Typography sx={{ fontSize: 12.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
        {usage.used} / {usage.limit}
      </Typography>
      <Box sx={{ width: 56, height: 5, borderRadius: 99, bgcolor: "var(--track)", overflow: "hidden" }}>
        <Box sx={{ width: `${usageFraction(usage) * 100}%`, height: "100%", bgcolor: color }} />
      </Box>
    </Box>
  );
}
