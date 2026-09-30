"use client";

import { Box, Typography, Button, Alert } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import { useAction } from "@/lib/useAction";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

export function DecisionActions({
  id,
  onDecided,
  bar,
}: {
  id: number;
  onDecided: (updated: RecommendationOut) => void;
  /** Lay the actions out as one row with this title on the left (the desktop detail bar). */
  bar?: string;
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

  if (bar) {
    return (
      <Box sx={{ width: "100%" }}>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.75 }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{bar}</Typography>
            <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
              Recorded here only. Nothing is sent to a broker.
            </Typography>
          </Box>
          <Button variant="outlined" disabled={submitting} onClick={() => decide("reject")}>
            Dismiss
          </Button>
          <Button variant="contained" disabled={submitting} onClick={() => decide("approve")}>
            Approve
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: "flex", gap: 1.25, mt: 1.5 }}>
        <Button variant="contained" disabled={submitting} onClick={() => decide("approve")} sx={{ flex: 1.3 }}>
          Approve
        </Button>
        <Button variant="outlined" disabled={submitting} onClick={() => decide("reject")} sx={{ flex: 1 }}>
          Dismiss
        </Button>
      </Box>
      <Typography sx={{ fontSize: 12, color: "var(--muted)", mt: 1, textAlign: "center" }}>
        Approving records your decision. Nothing is sent to a broker.
      </Typography>
    </>
  );
}
