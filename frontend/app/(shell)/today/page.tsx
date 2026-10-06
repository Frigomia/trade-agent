"use client";

import { useState } from "react";
import useSWR from "swr";
import { Box, Typography, Alert, Button, useMediaQuery, useTheme } from "@mui/material";
import { Play } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut, JobStatus } from "@/lib/api/recommendation-types";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import { TodayEmpty } from "@/components/recommendations/TodayEmpty";
import { RecommendationCard } from "@/components/recommendations/RecommendationCard";
import { toTime } from "@/components/portfolio/PortfolioChart";
import { PortfolioTile } from "@/components/portfolio/PortfolioTile";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { CostBasisTile, TodayDesktop } from "@/components/recommendations/TodayDesktop";
import { useDailySnapshot } from "@/lib/portfolio/useDailySnapshot";
import { ClaudeRequired } from "@/components/claude/ClaudeRequired";
import { isClaudeKeyRequired, useClaudeLock } from "@/lib/claudeKey";

const ACTION_ORDER = ["BUY", "ADD", "HOLD", "TRIM", "SELL", "WATCH"] as const;

// When the newest pending recommendation was made, in local time: just the time when it is from
// today, otherwise with the weekday ("Mon 07:31") so an old call is not mistaken for a fresh one.
function lastAnalysis(recs: RecommendationOut[] | undefined, now: number): string | null {
  if (!recs || recs.length === 0) return null;
  const newest = new Date(toTime(recs.map((r) => r.created_at).sort().at(-1)!));
  const time = newest.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (newest.toDateString() === new Date(now).toDateString()) return time;
  return `${newest.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function AwaitingTile({ recommendations }: { recommendations: RecommendationOut[] }) {
  const parts = ACTION_ORDER.flatMap((action) => {
    const count = recommendations.filter((r) => r.action === action).length;
    return count > 0 ? [`${count} ${action}`] : [];
  });
  return (
    <Panel sx={{ p: "12px 13px", flex: 1, minWidth: 0 }}>
      <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Awaiting you</Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.035em", mt: 0.5 }}>
        {recommendations.length}
      </Typography>
      {parts.length > 0 && (
        <Typography sx={{ fontSize: 11.5, color: "var(--muted)", mt: 1 }}>{parts.join(" · ")}</Typography>
      )}
    </Panel>
  );
}

export default function TodayPage() {
  const isDesktop = useMediaQuery(useTheme().breakpoints.up("md"));
  useDailySnapshot();
  const {
    data: recommendations,
    error: loadError,
    mutate,
  } = useSWR<RecommendationOut[]>("/analysis/recommendations?status=PENDING", apiFetch);
  // Same key as PortfolioTile, so SWR shares one request.
  const { data: summary, error: summaryError } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const [jobId, setJobId] = useState<string | null>(null);
  const [now] = useState(() => Date.now()); // lazy: the purity lint forbids Date.now() in render
  const [runError, setRunError] = useState<string | null>(null);
  const { lock, markRequired } = useClaudeLock();

  // jobId is deliberately never cleared once set: `job` stays cached after polling stops, so the
  // FAILED/DONE banners below keep rendering. A second Run-analysis click just sets a new id.
  const { data: job } = useSWR<JobStatus>(jobId ? `/analysis/run/${jobId}` : null, apiFetch, {
    refreshInterval: (data) => (data?.status === "RUNNING" ? 2000 : 0),
    // A terminal status is the last response polling fetches: pull in the new recommendations.
    onSuccess: (data) => {
      if (data.status !== "RUNNING") mutate();
    },
  });

  const running = jobId !== null && (!job || job.status === "RUNNING");

  async function runAnalysis() {
    setRunError(null);
    try {
      const { job_id } = await apiFetch<{ job_id: string }>("/analysis/run", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setJobId(job_id);
    } catch (err) {
      if (isClaudeKeyRequired(err)) markRequired();
      else setRunError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  const failedCount = job?.status === "DONE" ? job.results.filter((r) => r.error).length : 0;

  const pending = recommendations ?? [];
  const lastRun = lastAnalysis(recommendations, now);

  // Nothing is pending. Someone with no holdings and no watchlist gets the first steps, everyone else
  // the all-clear. While the portfolio is still loading neither shows, so the wrong one never flashes;
  // if it fails to load the all-clear is the safe, truthful default.
  let emptyKind: "first-run" | "all-clear" | null = null;
  if (summary) {
    const hasPortfolio = summary.holdings.some((h) => h.shares > 0) || summary.watchlist.length > 0;
    emptyKind = hasPortfolio ? "all-clear" : "first-run";
  } else if (summaryError) {
    emptyKind = "all-clear";
  }

  return (
    <Box>
      <PageHeader
        title="Today"
        subtitle={lastRun ? `Last analysis ${lastRun}` : undefined}
        actions={
          <Button
            variant="text"
            startIcon={<Play size={14} />}
            disabled={running || lock !== null}
            onClick={runAnalysis}
            sx={{
              minHeight: 0,
              px: 1.5,
              py: 0.9,
              borderRadius: 999,
              fontSize: 12.5,
              bgcolor: "var(--up-bg)",
              "&:hover": { bgcolor: "var(--up-bg)", filter: "brightness(1.1)" },
            }}
          >
            {running ? "Running…" : "Run analysis"}
          </Button>
        }
      />
      {lock && (
        <>
          <ClaudeRequired variant="today" lock={lock} />
          <Typography sx={{ fontSize: 12.5, color: "var(--muted)", mb: 1.5 }}>
            {lock === "reconnect" ? "Reconnect Claude to run an analysis" : "Connect Claude to run an analysis"}. Everything else
            works without it.
          </Typography>
        </>
      )}
      <Box sx={{ display: "flex", gap: 1.25 }}>
        <PortfolioTile />
        {isDesktop && <CostBasisTile />}
        <AwaitingTile recommendations={pending} />
      </Box>
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load recommendations.
        </Alert>
      )}
      {runError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {runError}
        </Alert>
      )}
      {job?.status === "FAILED" && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Analysis failed. Try again in a moment.
        </Alert>
      )}
      {job?.status === "DONE" && failedCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {job.results.length - failedCount} analyzed, {failedCount} failed.
        </Alert>
      )}
      {recommendations?.length === 0 && emptyKind !== null && (
        <TodayEmpty firstRun={emptyKind === "first-run"} running={running} locked={lock !== null} onRun={runAnalysis} />
      )}
      {isDesktop && pending.length > 0 && <TodayDesktop recommendations={pending} />}
      {!isDesktop && recommendations?.map((recommendation) => (
        // No inline confirmation here — approving/dismissing just revalidates the list, and the
        // card disappears because it's no longer PENDING. The full "Decision recorded" screen is
        // the detail page's job (/today/[id], Task 7); "Back to Today" would be nonsensical copy
        // on the page you're already standing on.
        <RecommendationCard key={recommendation.id} recommendation={recommendation} onDecided={() => mutate()} />
      ))}
    </Box>
  );
}
