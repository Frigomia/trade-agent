import { Box, Typography } from "@mui/material";
import { usageFraction, usageLevel, type UsageDetail } from "@/lib/usage";

const CUE = { ok: "", warn: "Near limit", limit: "At limit" } as const;

/** The quiet "44 / 100" chat allowance with a thin bar; near and at the limit the bar turns amber and a word says so. */
export function UsageMeter({ usage }: { usage: UsageDetail }) {
  const level = usageLevel(usage);
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1.25 }} title="Chat messages used this month">
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {CUE[level] && (
          <Box component="strong" sx={{ color: "var(--warn)", fontWeight: 650 }}>
            {CUE[level]}{" "}
          </Box>
        )}
        <span>
          {usage.used} / {usage.limit}
        </span>
      </Typography>
      {/* The bar is dropped on phones so the header fits on one row. */}
      <Box sx={{ display: { xs: "none", sm: "block" }, width: 56, height: 6, borderRadius: 99, bgcolor: "var(--track)", overflow: "hidden" }}>
        <Box sx={{ width: `${usageFraction(usage) * 100}%`, height: "100%", bgcolor: level === "ok" ? "var(--accent-solid)" : "var(--warn)" }} />
      </Box>
    </Box>
  );
}
