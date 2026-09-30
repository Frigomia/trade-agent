"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Alert, Box, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { formatPct } from "@/lib/format";
import { buildTrackRecord, type Verdict } from "@/lib/trackRecord";

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
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 650 }}>
          Track record
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Link href="/more">Back to More</Link>
      </Box>

      {error && <Alert severity="error">Could not load your track record.</Alert>}

      {summary && summary.scored === 0 && (
        <Typography sx={{ color: "var(--text2)" }}>
          No scored calls yet. A call is scored 20 days after it is made.
        </Typography>
      )}

      {summary && summary.scored > 0 && (
        <>
          <Typography sx={{ fontSize: 18, fontWeight: 600 }}>
            {summary.matched} of {summary.scored} calls moved the way the action implied
          </Typography>
          <Typography sx={{ color: "var(--text2)", fontSize: 13, mb: 2 }}>
            A small sample, not a forecast.
          </Typography>
        </>
      )}

      {summary && summary.rows.length > 0 && (
        <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
          {summary.rows.map(({ rec, verdict, movePct }) => (
            <Box
              component="li"
              key={rec.id}
              sx={{ display: "flex", gap: 1.5, alignItems: "baseline", py: 1, borderBottom: "1px solid var(--border)" }}
            >
              <Typography sx={{ fontWeight: 600, width: 64 }}>{rec.ticker}</Typography>
              <Typography sx={{ width: 56 }}>{rec.action}</Typography>
              <Typography sx={{ color: "var(--text2)", flex: 1, fontSize: 13 }}>
                {rec.created_at.slice(0, 10)} · {DECISION_WORD[rec.status] ?? rec.status}
              </Typography>
              <Typography sx={{ width: 64, textAlign: "right" }}>
                {movePct === null ? "—" : formatPct(movePct)}
              </Typography>
              <Typography sx={{ width: 84, fontSize: 13 }}>{VERDICT_WORD[verdict]}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
