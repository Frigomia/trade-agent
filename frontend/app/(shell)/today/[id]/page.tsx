"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Box, Typography, Button, Alert, Chip } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { EvidencePanel } from "@/components/recommendations/EvidencePanel";
import { WebOpinionBox } from "@/components/recommendations/WebOpinionBox";
import { ConfirmationPanel } from "@/components/recommendations/ConfirmationPanel";

export default function RecommendationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: recommendation, error: loadError, mutate } = useSWR<RecommendationOut>(
    `/analysis/recommendations/${id}`,
    apiFetch,
  );
  const [decided, setDecided] = useState<RecommendationOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loadError) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {loadError instanceof ApiError ? loadError.detail : "Could not load this recommendation."}
      </Alert>
    );
  }

  if (!recommendation) {
    return null;
  }

  const current = decided ?? recommendation;

  if (current.status !== "PENDING") {
    return (
      <ConfirmationPanel
        recommendation={current}
        onChanged={setDecided}
        onBackToToday={() => router.push("/today")}
      />
    );
  }

  async function decide(action: "approve" | "reject") {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetch<RecommendationOut>(
        `/analysis/recommendations/${current.id}/${action}`,
        { method: "POST" },
      );
      setDecided(updated);
      mutate(updated, { revalidate: false });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ maxWidth: 480 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
        <Typography sx={{ fontSize: 30, fontWeight: 650, letterSpacing: "-.03em" }}>
          {current.ticker}
        </Typography>
        <Chip label={current.action} size="small" />
      </Box>
      <EvidencePanel recommendation={current} />
      <Box sx={{ mt: 1.5 }}>
        {current.reasoning.map((line, i) => (
          <Typography key={i} sx={{ fontSize: 13, color: "var(--text2)", mt: 0.5 }}>
            {line}
          </Typography>
        ))}
      </Box>
      {current.ai_analysis && <WebOpinionBox text={current.ai_analysis} />}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: "flex", gap: 1.25, mt: 2 }}>
        <Button variant="outlined" fullWidth disabled={submitting} onClick={() => decide("reject")}>
          Dismiss
        </Button>
        <Button variant="contained" fullWidth disabled={submitting} onClick={() => decide("approve")}>
          Approve
        </Button>
      </Box>
      <Typography sx={{ fontSize: 12, color: "var(--muted)", mt: 1, textAlign: "center" }}>
        Approving records your decision. Nothing is sent to a broker.
      </Typography>
    </Box>
  );
}
