"use client";

import { useState } from "react";
import { Box, Typography, Button, Alert } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

export function DecisionActions({
  id,
  onDecided,
}: {
  id: number;
  onDecided: (updated: RecommendationOut) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function decide(action: "approve" | "reject") {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      onDecided(
        await apiFetch<RecommendationOut>(`/analysis/recommendations/${id}/${action}`, {
          method: "POST",
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: "flex", gap: 1.25, mt: 1.5 }}>
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
    </>
  );
}
