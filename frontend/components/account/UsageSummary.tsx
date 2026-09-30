"use client";

import { useState } from "react";
import { Alert, Box, LinearProgress, Stack, Typography } from "@mui/material";
import { nextResetDate, usageFraction, usageLevel, type Usage, type UsageDetail } from "@/lib/usage";

const CUE = { ok: "", warn: "Near limit", limit: "At limit" } as const;

function UsageRow({ label, detail }: { label: string; detail: UsageDetail }) {
  const level = usageLevel(detail);
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "110px 1fr auto", alignItems: "center", gap: 1.5 }}>
      <Typography variant="body2">{label}</Typography>
      <LinearProgress
        variant="determinate"
        aria-label={label}
        value={usageFraction(detail) * 100}
        color={level === "ok" ? "primary" : "warning"}
      />
      <Typography variant="body2" sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {CUE[level] && <strong>{CUE[level]} </strong>}
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
    <Stack spacing={2}>
      {atLimit && (
        <Alert severity="warning">
          You have used your monthly allowance. It resets on {resetDate}. Ask your administrator if you need more.
        </Alert>
      )}
      <Box sx={{ display: "flex", alignItems: "baseline" }}>
        <Typography sx={{ fontWeight: 650 }}>Your usage</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Resets on {resetDate}
        </Typography>
      </Box>
      <UsageRow label="Analysis runs" detail={usage.analysis_runs} />
      <UsageRow label="Chat messages" detail={usage.chat_messages} />
    </Stack>
  );
}
