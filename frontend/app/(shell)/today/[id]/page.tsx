"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { Box, Typography, Alert } from "@mui/material";
import { ChevronLeft } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { ActionChip, PriceBlock } from "@/components/recommendations/RecommendationCard";
import { DecisionActions } from "@/components/recommendations/DecisionActions";
import { EvidencePanel } from "@/components/recommendations/EvidencePanel";
import { WebOpinionBox } from "@/components/recommendations/WebOpinionBox";
import { ConfirmationPanel } from "@/components/recommendations/ConfirmationPanel";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

// The mockup's detail header: a quiet back link and the round theme toggle.
function BackRow() {
  return (
    <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
      <Box
        component={Link}
        href="/today"
        sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, textDecoration: "none", color: "var(--muted)", fontSize: 14 }}
      >
        <ChevronLeft size={18} />
        Today
      </Box>
      <Box sx={{ flex: 1 }} />
      <ThemeToggle />
    </Box>
  );
}

export default function RecommendationDetailPage() {
  return (
    <>
      <BackRow />
      <RecommendationDetail />
    </>
  );
}

function RecommendationDetail() {
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

  if (!validId || loadError) {
    return (
      <Alert severity="error">
        {!validId
          ? "Recommendation not found."
          : loadError instanceof ApiError
            ? loadError.detail
            : "Could not load this recommendation."}
      </Alert>
    );
  }

  if (!recommendation) {
    return null;
  }

  if (recommendation.status === "SUPERSEDED") {
    return (
      <Alert severity="info">
        A newer analysis replaced this recommendation for {recommendation.ticker}.
      </Alert>
    );
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
      {recommendation.ai_analysis && <WebOpinionBox text={recommendation.ai_analysis} />}
      <DecisionActions id={recommendation.id} onDecided={setDecided} />
    </Box>
  );
}
