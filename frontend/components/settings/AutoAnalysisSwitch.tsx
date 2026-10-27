"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Box, Switch, SvgIcon, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { AutoAnalysisPaused, Preferences } from "@/lib/preferences";
import { useAction } from "@/lib/useAction";

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
  if (paused.reason === "reserved") {
    return <>Paused: your last monthly run is kept available for portfolio analysis or a manual run.
      {paused.resumes_on && ` It resumes on ${longDate(paused.resumes_on)}.`}</>;
  }
  const used = paused.limit === null ? "all your runs" : `all ${paused.limit} runs`;
  return (
    <>
      Paused: you have used {used} this month.
      {paused.resumes_on && ` It resumes on ${longDate(paused.resumes_on)}.`}
    </>
  );
}

/** Each switch saves only its own field, independently of the other switch and form drafts. */
export function AutoAnalysisSwitch({ saved, onSaved, kind = "analysis" }: { saved: Preferences; onSaved: () => unknown; kind?: "analysis" | "discovery" }) {
  const field = kind === "discovery" ? "auto_discovery" : "auto_analysis";
  const label = kind === "discovery" ? "Discover new ideas automatically each weekday" : "Analyze my portfolio automatically each weekday";
  const explain = kind === "discovery"
    ? "Uses your Claude key to research up to 8 candidates each weekday, even without holdings. Counts as one additional run of your monthly limit; portfolio analysis uses a separate run. Keeps your last run available."
    : "Runs once each weekday morning and counts as one run of your monthly limit.";
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const { run, submitting, error } = useAction();
  const on = optimistic ?? Boolean(saved[field]);
  const paused = on ? saved[`${field}_paused`] : null;

  function toggle(next: boolean) {
    setOptimistic(next);
    return run(async () => {
      try {
        await apiFetch("/preferences", {
          method: "POST",
          body: JSON.stringify({ [field]: next }),
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
          <Typography id={`${field}-label`} variant="subtitle2" component="h2" sx={{ fontSize: "0.9375rem" }}>
            {label}
          </Typography>
          <Typography id={`${field}-hint`} sx={{ fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.5, mt: 0.5 }}>
            {explain}
          </Typography>
        </Box>
        <Switch
          checked={on}
          disabled={submitting}
          onChange={(_, next) => toggle(next)}
          slotProps={{ input: { "aria-labelledby": `${field}-label`, "aria-describedby": `${field}-hint` } }}
          sx={paused ? { "& .MuiSwitch-switchBase.Mui-checked": { color: "var(--warn)" }, "& .MuiSwitch-track": { bgcolor: "var(--warn)" } } : undefined}
        />
      </Box>
      {paused && (
        <Box
          role="status"
          sx={{ mt: 1.25, display: "flex", gap: 1, alignItems: "flex-start", color: "var(--warn)", fontSize: "0.8125rem", "& a": { color: "inherit", textDecoration: "underline" } }}
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
