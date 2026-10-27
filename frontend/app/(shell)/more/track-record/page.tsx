"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import { Check, Minus, X, type LucideIcon } from "lucide-react";
import { Alert, Box, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { formatPct } from "@/lib/format";
import { buildTrackRecord, type Kind, type Verdict } from "@/lib/trackRecord";
import { PageHeader } from "@/components/shell/PageHeader";
import { ActionChip } from "@/components/recommendations/RecommendationCard";
import { Bar } from "@/components/ui/Bar";
import { Panel } from "@/components/ui/Panel";
import { TrackRecordEmpty } from "@/components/recommendations/TrackRecordEmpty";

const VERDICT_WORD: Record<Verdict, string> = {
  matched: "Matched",
  missed: "Missed",
  unscored: "Not scored",
};

// The verdict is an icon and a word, never a colour: the move beside it is green or red because it is a price move.
const VERDICT_ICON: Record<Verdict, LucideIcon> = { matched: Check, missed: X, unscored: Minus };

function VerdictMark({ verdict }: { verdict: Verdict }) {
  const Icon = VERDICT_ICON[verdict];
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.625, fontSize: "0.75rem", color: "var(--text2)" }}>
      <Icon size={13} aria-hidden />
      {VERDICT_WORD[verdict]}
    </Box>
  );
}

const DECISION_WORD: Record<string, string> = {
  APPROVED: "Approved",
  REJECTED: "Dismissed",
  PENDING: "Pending",
  SUPERSEDED: "Replaced or withdrawn",
};

const KIND_WORD: Record<Kind, string> = { holdings: "Holdings call", discovery: "Discovery idea" };
const KIND_GROUP: Record<Kind, string> = { holdings: "Holdings calls", discovery: "Discovery ideas" };
const KINDS: Kind[] = ["holdings", "discovery"];

export default function TrackRecordPage() {
  const { data, error, mutate } = useSWR<RecommendationOut[]>("/analysis/recommendations", apiFetch);
  const asked = useRef(false);

  // Nothing computes outcomes on a schedule, so opening this page asks the backend to evaluate
  // whatever is due (28 days old, batch of 50). Best effort: a failure just leaves older data.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    apiFetch("/memory/evaluate-outcomes", { method: "POST" })
      .then(() => mutate())
      .catch(() => {});
  }, [mutate]);

  const summary = data ? buildTrackRecord(data) : null;

  return (
    <Box sx={{ maxWidth: 860 }}>
      <PageHeader title="Track record" subtitle="How past calls looked 20 trading days later" />

      {error && <Alert severity="error">Could not load your track record.</Alert>}

      {summary && summary.rows.length === 0 && <TrackRecordEmpty />}

      {summary && summary.rows.length > 0 && (
        <Panel sx={{ p: "20px 24px", mb: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(auto-fit, minmax(220px, 1fr))" }, gap: 2.5 }}>
            {KINDS.filter((kind) => summary.bySource[kind].count > 0).map((kind) => {
              const { count, matched, scored } = summary.bySource[kind];
              return (
                <Box component="section" key={kind} aria-label={KIND_GROUP[kind]}>
                  <Typography sx={{ fontSize: "0.8125rem", fontWeight: 650, color: "var(--text2)" }}>
                    {KIND_GROUP[kind]}
                  </Typography>
                  <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {count} {count === 1 ? "call" : "calls"}, {scored} scored
                  </Typography>
                  {scored === 0 ? (
                    <Typography sx={{ fontSize: "0.9375rem", mt: 0.75, color: "var(--muted)" }}>None scored yet</Typography>
                  ) : (
                    <>
                      <Typography sx={{ fontSize: "2.5rem", fontWeight: 650, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
                        {matched}{" "}
                        <Box component="span" sx={{ color: "var(--muted)", fontSize: "1.75rem" }}>
                          of {scored}
                        </Box>
                      </Typography>
                      <Typography sx={{ fontSize: "0.9375rem", mt: 0.5 }}>calls moved the way the action implied</Typography>
                      <Bar value={(matched / scored) * 100} label={`${KIND_GROUP[kind]} matched`} valueText={`${matched} of ${scored}`} sx={{ mt: 1.5 }} />
                    </>
                  )}
                </Box>
              );
            })}
          </Box>
          <Typography sx={{ color: "var(--muted)", fontSize: "0.75rem", mt: 1.75 }}>
            {summary.scored > 0 &&
              "Each percentage below is the stock's own price change over 20 trading days from the call's day, or, when a row says " +
                "\"Measured from\", from that earlier close (a discovery idea uses the close its saved snapshot was taken at): no " +
                "benchmark, no dividends. "}
            HOLD and WATCH aren&apos;t scored, and a company that a later scan found again counts again. A small sample,
            not a forecast.
          </Typography>
        </Panel>
      )}

      {summary && summary.rows.length > 0 && (
        <Panel sx={{ p: "2px 20px" }}>
        <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
          {summary.rows.map(({ rec, kind, entryDay, verdict, movePct }) => (
            <Box
              component="li"
              key={rec.id}
              sx={{
                display: "flex",
                gap: 1.25,
                alignItems: "center",
                py: 1.75,
                borderBottom: "1px solid var(--line)",
                "&:last-of-type": { borderBottom: 0 },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography sx={{ fontWeight: 650, fontSize: "0.9375rem" }}>{rec.ticker}</Typography>
                  <ActionChip action={rec.action} />
                </Box>
                <Typography sx={{ color: "var(--muted)", fontSize: "0.75rem", mt: 0.25 }}>
                  {rec.created_at.slice(0, 10)} · {KIND_WORD[kind]} · {DECISION_WORD[rec.status] ?? rec.status}
                </Typography>
                {movePct !== null && entryDay !== rec.created_at.slice(0, 10) && (
                  <Typography sx={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                    Measured from the first close on or after {entryDay}
                  </Typography>
                )}
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
                <VerdictMark verdict={verdict} />
              </Box>
            </Box>
          ))}
        </Box>
        </Panel>
      )}
    </Box>
  );
}
