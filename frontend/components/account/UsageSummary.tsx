"use client";

import { useState } from "react";
import { Alert, Box, Stack, Typography } from "@mui/material";
import { nextResetDate, usageFraction, usageLevel, type Usage, type UsageDetail } from "@/lib/usage";

const CUE = { ok: "", warn: "Near limit", limit: "At limit" } as const;

/** The word carries the state; the amber bar is only a second cue (never colour alone). */
function UsageRow({ label, detail }: { label: string; detail: UsageDetail }) {
  const level = usageLevel(detail);
  const percent = usageFraction(detail) * 100;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "minmax(0, 1fr) auto", sm: "116px minmax(0, 1fr) auto" },
        gridTemplateAreas: { xs: '"l c" "b b"', sm: '"l b c"' },
        alignItems: "center",
        columnGap: 1.75,
        rowGap: 1,
      }}
    >
      <Typography sx={{ gridArea: "l", fontSize: "0.8125rem" }}>{label}</Typography>
      <Box
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={`${detail.used} of ${detail.limit}`}
        sx={{ gridArea: "b", height: 8, borderRadius: 999, bgcolor: "var(--track)", overflow: "hidden" }}
      >
        <Box sx={{ height: "100%", width: `${percent}%`, borderRadius: 999, bgcolor: level === "ok" ? "var(--accent-solid)" : "var(--warn)" }} />
      </Box>
      <Typography sx={{ gridArea: "c", fontSize: "0.8125rem", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {CUE[level] && (
          <Box component="strong" sx={{ color: "var(--warn)", fontWeight: 650 }}>
            {CUE[level]}{" "}
          </Box>
        )}
        <span>{`${detail.used} / ${detail.limit}`}</span>
      </Typography>
    </Box>
  );
}

export function UsageSummary({ usage, now }: { usage: Usage; now?: Date }) {
  const [initialNow] = useState(() => new Date());
  const resetDate = nextResetDate(now ?? initialNow);
  const atLimit = usageLevel(usage.analysis_runs) === "limit" || usageLevel(usage.chat_messages) === "limit";
  return (
    <Stack spacing={1.75}>
      {atLimit && (
        <Alert severity="warning">
          You have used your monthly allowance. It resets on {resetDate}. Ask your administrator if you need more.
        </Alert>
      )}
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5 }}>
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650 }}>
          Your usage
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Resets on {resetDate}</Typography>
      </Box>
      <UsageRow label="Analysis runs" detail={usage.analysis_runs} />
      <UsageRow label="Chat messages" detail={usage.chat_messages} />
    </Stack>
  );
}
