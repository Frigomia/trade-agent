"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Box, Typography, Alert, Button } from "@mui/material";
import { Play } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut, JobStatus } from "@/lib/api/recommendation-types";
import { RecommendationCard } from "@/components/recommendations/RecommendationCard";

export default function TodayPage() {
  const {
    data: recommendations,
    error: loadError,
    mutate,
  } = useSWR<RecommendationOut[]>("/analysis/recommendations?status=PENDING", apiFetch);
  const [jobId, setJobId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const { data: job } = useSWR<JobStatus>(
    jobId ? `/analysis/run/${jobId}` : null,
    apiFetch,
    { refreshInterval: (data) => (data?.status === "RUNNING" ? 2000 : 0) },
  );

  // Once a job reaches a terminal state (DONE or FAILED), pull in whatever new recommendations
  // exist. This runs once per job id — deliberately NOT by nulling jobId back out here: doing
  // that synchronously during render (a plausible first instinct) discards the very render that
  // would have shown the FAILED/DONE banner, since React re-runs the component immediately with
  // the cleared id before ever committing, and the job's SWR key (and so `job` itself) goes back
  // to undefined. Leaving jobId set keeps `job` cached — polling just stops — so the banner below
  // keeps rendering; a second Run-analysis click starts fresh regardless, since it sets a new id.
  const settledJobId = useRef<string | null>(null);
  useEffect(() => {
    if (jobId && job && job.status !== "RUNNING" && settledJobId.current !== jobId) {
      settledJobId.current = jobId;
      mutate();
    }
  }, [jobId, job, mutate]);

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

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 650 }}>
          Today
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>
          Awaiting you: {recommendations?.length ?? 0}
        </Typography>
        {recommendations && recommendations.length > 0 && (
          // Hidden once the list is empty: the empty state below owns the "Run analysis" call
          // to action then, and showing it in both places would duplicate the same button
          // (identically labeled) on screen at once.
          <Button
            variant="outlined"
            startIcon={<Play size={14} />}
            disabled={running}
            onClick={runAnalysis}
          >
            {running ? "Running…" : "Run analysis"}
          </Button>
        )}
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
        <Box sx={{ textAlign: "center", py: 6 }}>
          <Typography sx={{ color: "var(--muted)", mb: 2 }}>No recommendations right now.</Typography>
          <Button variant="contained" startIcon={<Play size={14} />} disabled={running} onClick={runAnalysis}>
            Run analysis
          </Button>
        </Box>
      )}
      {recommendations?.map((recommendation) => (
        // No inline confirmation here — approving/dismissing just revalidates the list, and the
        // card disappears because it's no longer PENDING. The full "Decision recorded" screen is
        // the detail page's job (/today/[id], Task 7); "Back to Today" would be nonsensical copy
        // on the page you're already standing on.
        <RecommendationCard key={recommendation.id} recommendation={recommendation} onDecided={() => mutate()} />
      ))}
    </Box>
  );
}
