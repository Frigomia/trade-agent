"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Box, Switch, SvgIcon, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { AutoAnalysisPaused, Preferences } from "@/lib/preferences";
import { useAction } from "@/lib/useAction";

const LABEL = "Analyze my portfolio automatically each weekday";
const EXPLAIN = "Runs once each weekday morning and counts as one run of your monthly limit.";

// "YYYY-MM-DD" read as a local calendar date, so the day never shifts with the time zone.
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function PausedText({ paused }: { paused: AutoAnalysisPaused }) {
  if (paused.reason === "no_key") {
    return (
      <>
        Paused: <Link href="/more/connect-claude">connect your Claude key</Link> to turn this on.
      </>
    );
  }
  if (paused.limit === 0) return <>Paused: your monthly limit is 0 runs.</>;
  const used = paused.limit === null ? "all your runs" : `all ${paused.limit} runs`;
  return (
    <>
      Paused: you have used {used} this month.
      {paused.resumes_on && ` It resumes on ${longDate(paused.resumes_on)}.`}
    </>
  );
}

/** Saves on toggle. POST /preferences only updates the fields sent, so only `auto_analysis` goes. */
export function AutoAnalysisSwitch({ saved, onSaved }: { saved: Preferences; onSaved: () => unknown }) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const { run, submitting, error } = useAction();
  const on = optimistic ?? Boolean(saved.auto_analysis);
  const paused = on ? saved.auto_analysis_paused : null;

  function toggle(next: boolean) {
    setOptimistic(next);
    return run(async () => {
      try {
        await apiFetch("/preferences", {
          method: "POST",
          body: JSON.stringify({ auto_analysis: next }),
        });
        await onSaved();
      } finally {
        setOptimistic(null); // success: the refetched data now says so; failure: roll back
      }
    });
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography id="auto-analysis-label" variant="subtitle2" component="h2" sx={{ fontSize: 16 }}>
            {LABEL}
          </Typography>
          <Typography id="auto-analysis-hint" sx={{ fontSize: 12.5, color: "var(--muted)" }}>
            {EXPLAIN}
          </Typography>
        </Box>
        <Switch
          checked={on}
          disabled={submitting}
          onChange={(_, next) => toggle(next)}
          slotProps={{ input: { "aria-labelledby": "auto-analysis-label", "aria-describedby": "auto-analysis-hint" } }}
          sx={paused ? { "& .MuiSwitch-switchBase.Mui-checked": { color: "var(--warn)" }, "& .MuiSwitch-track": { bgcolor: "var(--warn)" } } : undefined}
        />
      </Box>
      {paused && (
        <Box
          role="status"
          sx={{ mt: 1.25, display: "flex", gap: 1, alignItems: "flex-start", color: "var(--warn)", fontSize: 13.5, "& a": { color: "inherit", textDecoration: "underline" } }}
        >
          <SvgIcon fontSize="small" aria-hidden sx={{ mt: "1px" }}>
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </SvgIcon>
          <span>
            <PausedText paused={paused} />
          </span>
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1.25 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
