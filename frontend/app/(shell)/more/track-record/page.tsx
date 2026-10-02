"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import { Alert, Box, LinearProgress, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { formatPct } from "@/lib/format";
import { buildTrackRecord, type Verdict } from "@/lib/trackRecord";
import { PageHeader } from "@/components/shell/PageHeader";
import { ActionChip } from "@/components/recommendations/RecommendationCard";
import { Panel } from "@/components/ui/Panel";
import { TrackRecordEmpty } from "@/components/recommendations/TrackRecordEmpty";

const VERDICT_WORD: Record<Verdict, string> = {
  matched: "Matched",
  missed: "Missed",
  unscored: "Not scored",
};

const DECISION_WORD: Record<string, string> = {
  APPROVED: "Approved",
  REJECTED: "Dismissed",
  PENDING: "Pending",
};

export default function TrackRecordPage() {
  const { data, error, mutate } = useSWR<RecommendationOut[]>("/analysis/recommendations", apiFetch);
  const asked = useRef(false);

  // Nothing computes outcomes on a schedule, so opening this page asks the backend to evaluate
  // whatever is due (20 days old, batch of 50). Best effort: a failure just leaves older data.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    apiFetch("/memory/evaluate-outcomes", { method: "POST" })
      .then(() => mutate())
      .catch(() => {});
  }, [mutate]);

  const summary = data ? buildTrackRecord(data) : null;

  return (
    <Box>
      <PageHeader title="Track record" subtitle="How past calls looked 20 trading days later" />

      {error && <Alert severity="error">Could not load your track record.</Alert>}

      {summary && summary.scored === 0 && <TrackRecordEmpty />}

      {summary && summary.scored > 0 && (
        <Panel sx={{ p: "18px 20px", mb: 1.75 }}>
          <Typography sx={{ fontSize: 40, fontWeight: 650, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
            {summary.matched}
            <Box component="span" sx={{ color: "var(--muted)", fontSize: 28, ml: 1 }}>
              of {summary.scored}
            </Box>
          </Typography>
          <Typography sx={{ fontSize: 15, mt: 0.5 }}>calls moved the way the action implied</Typography>
          <LinearProgress
            variant="determinate"
            value={(summary.matched / summary.scored) * 100}
            sx={{ mt: 1.5 }}
          />
          <Typography sx={{ color: "var(--muted)", fontSize: 12, mt: 1.25 }}>
            HOLD and WATCH aren&apos;t scored. A small sample, not a forecast.
          </Typography>
        </Panel>
      )}

      {summary && summary.rows.length > 0 && (
        <Panel sx={{ p: "4px 18px" }}>
        <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
          {summary.rows.map(({ rec, verdict, movePct }) => (
            <Box
              component="li"
              key={rec.id}
              sx={{
                display: "flex",
                gap: 1.25,
                alignItems: "center",
                py: 1.5,
                borderBottom: "1px solid var(--line)",
                "&:last-of-type": { borderBottom: 0 },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography sx={{ fontWeight: 650, fontSize: 16 }}>{rec.ticker}</Typography>
                  <ActionChip action={rec.action} />
                </Box>
                <Typography sx={{ color: "var(--muted)", fontSize: 12, mt: 0.25 }}>
                  {rec.created_at.slice(0, 10)} · {DECISION_WORD[rec.status] ?? rec.status}
                </Typography>
              </Box>
              <Box sx={{ textAlign: "right" }}>
                <Typography
                  sx={{
                    fontWeight: 650,
                    fontVariantNumeric: "tabular-nums",
                    color: movePct === null ? "var(--muted)" : movePct < 0 ? "var(--down)" : "var(--up)",
                  }}
                >
                  {movePct === null ? "—" : formatPct(movePct)}
                </Typography>
                <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>{VERDICT_WORD[verdict]}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
        </Panel>
      )}
    </Box>
  );
}
