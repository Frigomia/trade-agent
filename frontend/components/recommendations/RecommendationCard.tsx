"use client";

import { useState } from "react";
import Link from "next/link";
import { Box, Typography, Button, Alert, Chip } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { Action, RecommendationOut } from "@/lib/api/recommendation-types";
import { EvidencePanel } from "./EvidencePanel";

// Matches the mockups' badge convention: BUY/ADD/HOLD/WATCH share the default accent badge,
// TRIM gets the warning color, SELL the down color (the one action styled inline, not via a
// shared class, in the original mockup — folded into this same lookup for one consistent path).
export const ACTION_COLOR: Record<Action, { bg: string; fg: string }> = {
  BUY: { bg: "var(--accent-solid)", fg: "var(--on-accent)" },
  ADD: { bg: "var(--accent-solid)", fg: "var(--on-accent)" },
  HOLD: { bg: "var(--accent-solid)", fg: "var(--on-accent)" },
  WATCH: { bg: "var(--accent-solid)", fg: "var(--on-accent)" },
  TRIM: { bg: "var(--warn)", fg: "var(--on-accent)" },
  SELL: { bg: "var(--down)", fg: "#fff" },
};

function reasoningLine(recommendation: RecommendationOut): string | null {
  if (recommendation.ai_analysis) {
    const end = recommendation.ai_analysis.indexOf(". ");
    return end === -1 ? recommendation.ai_analysis : recommendation.ai_analysis.slice(0, end + 1);
  }
  return recommendation.reasoning.at(-1) ?? null;
}

export function PriceBlock({ recommendation }: { recommendation: RecommendationOut }) {
  if (recommendation.current_price === null) return null;
  return (
    <Box sx={{ textAlign: "right" }}>
      <Typography sx={{ fontWeight: 600 }}>{recommendation.current_price.toFixed(2)}</Typography>
      {recommendation.price_change_pct !== null && (
        <Typography
          sx={{
            fontSize: 12,
            color: recommendation.price_change_pct >= 0 ? "var(--up)" : "var(--down)",
          }}
        >
          {recommendation.price_change_pct >= 0 ? "+" : ""}
          {recommendation.price_change_pct.toFixed(1)}%
        </Typography>
      )}
    </Box>
  );
}

export function RecommendationCard({
  recommendation,
  onDecided,
}: {
  recommendation: RecommendationOut;
  onDecided: (updated: RecommendationOut) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function decide(action: "approve" | "reject") {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetch<RecommendationOut>(
        `/analysis/recommendations/${recommendation.id}/${action}`,
        { method: "POST" },
      );
      onDecided(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const line = reasoningLine(recommendation);
  const colors = ACTION_COLOR[recommendation.action];

  return (
    <Box sx={{ p: 2, border: "1px solid var(--line)", borderRadius: 2, mb: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
        <Link
          href={`/today/${recommendation.id}`}
          style={{ color: "inherit", textDecoration: "none" }}
        >
          <Typography sx={{ fontSize: 26, fontWeight: 650, letterSpacing: "-.03em" }}>
            {recommendation.ticker}
          </Typography>
        </Link>
        <Chip
          label={recommendation.action}
          size="small"
          sx={{ bgcolor: colors.bg, color: colors.fg, fontWeight: 700 }}
        />
        <Box sx={{ flex: 1 }} />
        <PriceBlock recommendation={recommendation} />
      </Box>
      <EvidencePanel recommendation={recommendation} />
      {line && (
        <Typography sx={{ fontSize: 13, color: "var(--text2)", mt: 1.5 }}>{line}</Typography>
      )}
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
    </Box>
  );
}
