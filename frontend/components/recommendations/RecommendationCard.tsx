"use client";

import Link from "next/link";
import { Box, Typography, Chip } from "@mui/material";
import type { Action, RecommendationOut } from "@/lib/api/recommendation-types";
import { DecisionActions } from "./DecisionActions";
import { EvidencePanel, hasStructuredEvidence } from "./EvidencePanel";

// Matches the mockups' badge convention: BUY/ADD/HOLD/WATCH share the default accent badge,
// TRIM gets the warning color, SELL the down color (the one action styled inline, not via a
// shared class, in the original mockup — folded into this same lookup for one consistent path).
const ACCENT = { bg: "var(--accent-solid)", fg: "var(--on-accent)" };
const ACTION_COLOR: Record<Action, { bg: string; fg: string }> = {
  BUY: ACCENT,
  ADD: ACCENT,
  HOLD: ACCENT,
  WATCH: ACCENT,
  TRIM: { bg: "var(--warn)", fg: "var(--on-accent)" },
  SELL: { bg: "var(--down)", fg: "#fff" },
};

export function ActionChip({ action }: { action: Action }) {
  return (
    <Chip
      label={action}
      size="small"
      sx={{ bgcolor: ACTION_COLOR[action].bg, color: ACTION_COLOR[action].fg, fontWeight: 700 }}
    />
  );
}

function reasoningLine(recommendation: RecommendationOut): string | null {
  if (recommendation.ai_analysis) {
    const end = recommendation.ai_analysis.indexOf(". ");
    return end === -1 ? recommendation.ai_analysis : recommendation.ai_analysis.slice(0, end + 1);
  }
  if (hasStructuredEvidence(recommendation)) return null;
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
  const line = reasoningLine(recommendation);

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
        <ActionChip action={recommendation.action} />
        <Box sx={{ flex: 1 }} />
        <PriceBlock recommendation={recommendation} />
      </Box>
      <EvidencePanel recommendation={recommendation} />
      {line && (
        <Typography sx={{ fontSize: 13, color: "var(--text2)", mt: 1.5 }}>{line}</Typography>
      )}
      <DecisionActions id={recommendation.id} onDecided={onDecided} />
    </Box>
  );
}
