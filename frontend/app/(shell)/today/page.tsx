"use client";

import { useState } from "react";
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
        <Button
          variant="outlined"
          startIcon={<Play size={14} />}
          disabled={running}
          onClick={runAnalysis}
        >
          {running ? "Running…" : "Run analysis"}
        </Button>
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
