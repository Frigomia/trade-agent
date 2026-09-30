"use client";

import { useState } from "react";
import useSWR from "swr";
import { Box, Typography, Alert, Button, useMediaQuery, useTheme } from "@mui/material";
import { Play } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut, JobStatus } from "@/lib/api/recommendation-types";
import { RecommendationCard } from "@/components/recommendations/RecommendationCard";
import { PortfolioTile } from "@/components/portfolio/PortfolioTile";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { CostBasisTile, TodayDesktop } from "@/components/recommendations/TodayDesktop";
import { useDailySnapshot } from "@/lib/portfolio/useDailySnapshot";

const ACTION_ORDER = ["BUY", "ADD", "HOLD", "TRIM", "SELL", "WATCH"] as const;

// API timestamps are naive UTC; show the time the newest pending recommendation was made, locally.
function lastAnalysis(recs: RecommendationOut[] | undefined): string | null {
  if (!recs || recs.length === 0) return null;
  const newest = recs.map((r) => r.created_at).sort().at(-1)!;
  const parsed = new Date(/(Z|[+-]dd:?dd)$/i.test(newest) ? newest : `${newest}Z`);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AwaitingTile({ recommendations }: { recommendations: RecommendationOut[] }) {
  const parts = ACTION_ORDER.map((action) => [action, recommendations.filter((r) => r.action === action).length] as const)
    .filter(([, count]) => count > 0)
    .map(([action, count]) => `${count} ${action}`);
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
  const [jobId, setJobId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

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
      setRunError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  const failedCount = job?.status === "DONE" ? job.results.filter((r) => r.error).length : 0;

  const pending = recommendations ?? [];
  const lastRun = lastAnalysis(recommendations);

  return (
    <Box>
      <PageHeader
        title="Today"
        subtitle={lastRun ? `Last analysis ${lastRun}` : undefined}
        actions={
          <Button
            variant="text"
            startIcon={<Play size={14} />}
            disabled={running}
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
      {recommendations?.length === 0 && (
        <Typography sx={{ color: "var(--muted)", textAlign: "center", py: 6 }}>
          No recommendations right now.
        </Typography>
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
