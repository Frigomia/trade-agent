"use client";

import { Box, Typography, Button, Alert } from "@mui/material";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useAction } from "@/lib/useAction";
import { LogTradeCta } from "@/components/portfolio/LogTradeCta";
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
  const { run, submitting, error } = useAction();

  // The backend allows reversing a decision (the opposite action on an APPROVED or REJECTED
  // recommendation flips it), but not touching a superseded one (409).
  const changeDecision = () =>
    run(async () => {
      const oppositeAction = recommendation.status === "APPROVED" ? "reject" : "approve";
      onChanged(
        await apiFetch<RecommendationOut>(
          `/analysis/recommendations/${recommendation.id}/${oppositeAction}`,
          { method: "POST" },
        ),
      );
    });

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
      {approved && <LogTradeCta recommendation={recommendation} />}
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
