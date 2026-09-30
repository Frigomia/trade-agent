"use client";

import { Box, Typography, Button, Alert } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import { useAction } from "@/lib/useAction";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

export function DecisionActions({
  id,
  onDecided,
}: {
  id: number;
  onDecided: (updated: RecommendationOut) => void;
}) {
  const { run, submitting, error } = useAction();

  const decide = (action: "approve" | "reject") =>
    run(async () =>
      onDecided(
        await apiFetch<RecommendationOut>(`/analysis/recommendations/${id}/${action}`, {
          method: "POST",
        }),
      ),
    );

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
