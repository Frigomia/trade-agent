"use client";

import { Box, Typography, Button, Alert } from "@mui/material";
import { useSWRConfig } from "swr";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAction } from "@/lib/useAction";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

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
  const { run, submitting, error, setError } = useAction();
  const { mutate } = useSWRConfig();

  const decide = (action: "approve" | "reject") =>
    run(async () => {
      try {
        onDecided(
          await apiFetch<RecommendationOut>(`/analysis/recommendations/${id}/${action}`, {
            method: "POST",
          }),
        );
      } catch (err) {
        // 409: already decided or replaced. Show why and refetch the list and detail so the stale card updates.
        if (err instanceof ApiError && err.status === 409) {
          setError(err.detail);
          void mutate((key) => typeof key === "string" && key.startsWith("/analysis/recommendations"));
          return;
        }
        throw err;
      }
    });

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
            <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{title}</Typography>
            <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>{NOTE}</Typography>
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
          <Typography sx={{ fontSize: 12, color: "var(--muted)", mt: 1, textAlign: "center" }}>{NOTE}</Typography>
        </>
      )}
    </>
  );
}
