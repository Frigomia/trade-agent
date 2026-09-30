"use client";

import { useState } from "react";
import { Box, Typography, Button, Alert } from "@mui/material";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

export function ConfirmationPanel({
  recommendation,
  onChanged,
  onBackToToday,
}: {
  recommendation: RecommendationOut;
  onChanged: (updated: RecommendationOut) => void;
  onBackToToday: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function changeDecision() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    // Neither endpoint guards on the current status — calling the opposite action on an
    // already-decided recommendation cleanly reverses it. No backend change needed.
    const oppositeAction = recommendation.status === "APPROVED" ? "reject" : "approve";
    try {
      const updated = await apiFetch<RecommendationOut>(
        `/analysis/recommendations/${recommendation.id}/${oppositeAction}`,
        { method: "POST" },
      );
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const approved = recommendation.status === "APPROVED";

  return (
    <Box sx={{ textAlign: "center", p: 3 }}>
      <Box
        sx={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          mx: "auto",
          bgcolor: approved ? "var(--up-bg)" : "var(--down-bg)",
          color: approved ? "var(--up)" : "var(--down)",
        }}
      >
        <CheckCircle2 size={30} />
      </Box>
      <Typography sx={{ fontSize: 22, fontWeight: 650, mt: 2 }}>Decision recorded</Typography>
      <Typography sx={{ color: "var(--text2)", mt: 1 }}>
        You {approved ? "approved" : "dismissed"} {recommendation.ticker} &middot;{" "}
        {recommendation.action}.
      </Typography>
      {approved && (
        <Box
          sx={{
            display: "flex",
            gap: 1,
            textAlign: "left",
            mt: 2.5,
            p: 1.5,
            bgcolor: "var(--warn-bg)",
            borderRadius: 1.5,
          }}
        >
          <AlertTriangle size={17} color="var(--warn)" style={{ flexShrink: 0 }} />
          <Typography sx={{ fontSize: 13 }}>
            <b>No order was placed.</b> trade-agent never trades. If you decide to act, do it in your
            broker app.
          </Typography>
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 2, textAlign: "left" }}>
          {error}
        </Alert>
      )}
      <Button variant="outlined" fullWidth sx={{ mt: 2.5 }} onClick={onBackToToday}>
        Back to Today
      </Button>
      <Button
        variant="text"
        fullWidth
        sx={{ mt: 1 }}
        disabled={submitting}
        onClick={changeDecision}
      >
        Change my decision
      </Button>
    </Box>
  );
}
