"use client";

import { useState } from "react";
import { Alert, Box, LinearProgress, Stack, Typography } from "@mui/material";
import { nextResetDate, usageFraction, usageLevel, type Usage, type UsageDetail } from "@/lib/usage";

const CUE = { ok: "", warn: "Near limit", limit: "At limit" } as const;

function UsageRow({ label, detail }: { label: string; detail: UsageDetail }) {
  const level = usageLevel(detail);
  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2">
          {CUE[level] && <strong>{CUE[level]} </strong>}
          <span>{`${detail.used} / ${detail.limit}`}</span>
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        aria-label={label}
        value={usageFraction(detail) * 100}
        color={level === "ok" ? "primary" : "warning"}
      />
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
      <UsageRow label="Analysis runs" detail={usage.analysis_runs} />
      <UsageRow label="Chat messages" detail={usage.chat_messages} />
      <Typography variant="caption" color="text.secondary">
        Resets on {resetDate}
      </Typography>
    </Stack>
  );
}
