"use client";

import { Box, Typography, Button, Alert } from "@mui/material";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { useDecision } from "@/lib/useDecision";

const NOTE = "Approving records your decision. Nothing is sent to a broker.";

export function DecisionActions({
  id,
  onDecided,
  title,
}: {
  id: number;
  onDecided: (updated: RecommendationOut) => void;
  /** Lay the actions out as one row with this title on the left (the desktop detail bar). */
  title?: string;
}) {
  const { decide, submitting, error } = useDecision(id, onDecided);

  const dismiss = (
    <Button variant="outlined" disabled={submitting} onClick={() => decide("reject")} sx={{ flex: title ? "none" : 1 }}>
      Dismiss
    </Button>
  );
  const approve = (
    <Button variant="contained" disabled={submitting} onClick={() => decide("approve")} sx={{ flex: title ? "none" : 1.3 }}>
      Approve
    </Button>
  );

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: title ? 1.5 : 0, mt: title ? 0 : 1.5 }}>
          {error}
        </Alert>
      )}
      {title ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.75 }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 650, fontSize: "0.9375rem" }}>{title}</Typography>
            <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{NOTE}</Typography>
          </Box>
          {dismiss}
          {approve}
        </Box>
      ) : (
        <>
          <Box sx={{ display: "flex", gap: 1.25, mt: 1.5 }}>
            {approve}
            {dismiss}
          </Box>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", mt: 1, textAlign: "center" }}>{NOTE}</Typography>
        </>
      )}
    </>
  );
}
