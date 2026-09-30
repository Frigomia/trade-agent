"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Box, Typography, Alert } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { ActionChip, PriceBlock } from "@/components/recommendations/RecommendationCard";
import { DecisionActions } from "@/components/recommendations/DecisionActions";
import { EvidencePanel } from "@/components/recommendations/EvidencePanel";
import { WebOpinionBox } from "@/components/recommendations/WebOpinionBox";
import { ConfirmationPanel } from "@/components/recommendations/ConfirmationPanel";

export default function RecommendationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // The id goes straight into an authenticated API path, so only ever accept a plain integer:
  // a crafted /today/..%2Fsomething link must not steer the request to a different route.
  const validId = /^\d+$/.test(id);
  const { data: recommendation, error: loadError, mutate } = useSWR<RecommendationOut>(
    validId ? `/analysis/recommendations/${id}` : null,
    apiFetch,
  );
  // A decision (or a changed decision) is written straight into the SWR cache — no separate
  // local copy to keep in sync with it.
  const setDecided = (updated: RecommendationOut) => mutate(updated, { revalidate: false });

  if (!validId) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        Recommendation not found.
      </Alert>
    );
  }

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

  if (recommendation.status !== "PENDING") {
    return (
      <ConfirmationPanel
        recommendation={recommendation}
        onChanged={setDecided}
        onBackToToday={() => router.push("/today")}
      />
    );
  }

  return (
    <Box sx={{ maxWidth: 480 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
        <Typography sx={{ fontSize: 30, fontWeight: 650, letterSpacing: "-.03em" }}>
          {recommendation.ticker}
        </Typography>
        <ActionChip action={recommendation.action} />
        <Box sx={{ flex: 1 }} />
        <PriceBlock recommendation={recommendation} />
      </Box>
      <EvidencePanel recommendation={recommendation} />
      <Box sx={{ mt: 1.5 }}>
        {recommendation.reasoning.map((line, i) => (
          <Typography key={i} sx={{ fontSize: 13, color: "var(--text2)", mt: 0.5 }}>
            {line}
          </Typography>
        ))}
      </Box>
      {recommendation.ai_analysis && <WebOpinionBox text={recommendation.ai_analysis} />}
      <DecisionActions id={recommendation.id} onDecided={setDecided} />
    </Box>
  );
}
