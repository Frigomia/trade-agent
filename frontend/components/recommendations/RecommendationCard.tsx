"use client";

import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { Globe } from "lucide-react";
import type { Action, RecommendationOut } from "@/lib/api/recommendation-types";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { DecisionActions } from "./DecisionActions";
import { EvidencePanel } from "./EvidencePanel";

// The mockups' action badge: a small rounded square (not a pill). BUY/ADD/HOLD/WATCH share the
// emerald fill, TRIM is amber, SELL is coral; the word is always shown.
const ACCENT = { bg: "var(--accent-solid)", fg: "var(--on-accent)" };
const ACTION_COLOR: Record<Action, { bg: string; fg: string }> = {
  BUY: ACCENT,
  ADD: ACCENT,
  HOLD: ACCENT,
  WATCH: ACCENT,
  TRIM: { bg: "var(--warn)", fg: "var(--on-warn)" },
  SELL: { bg: "var(--down)", fg: "#fff" },
};

export function ActionChip({ action }: { action: Action }) {
  return (
    <Box
      component="span"
      sx={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.06em",
        px: "9px",
        py: "3px",
        borderRadius: "8px",
        bgcolor: ACTION_COLOR[action].bg,
        color: ACTION_COLOR[action].fg,
        lineHeight: 1.45,
      }}
    >
      {action}
    </Box>
  );
}

// The card's one-line take: the web opinion's first sentence. `reasoning` is deliberately not
// shown — it is only the raw wording of the score/signal EvidencePanel already renders.
function reasoningLine(recommendation: RecommendationOut): string | null {
  // The text is markdown; drop its markers so the card shows plain words.
  const text = recommendation.ai_analysis?.replace(/[#*`>]/g, "").trim();
  if (!text) return null;
  const end = text.indexOf(". ");
  return end === -1 ? text : text.slice(0, end + 1);
}

export function ChangePill({ pct }: { pct: number }) {
  return (
    <Pill tone={pct >= 0 ? "up" : "down"}>
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </Pill>
  );
}

export function PriceBlock({ recommendation }: { recommendation: RecommendationOut }) {
  if (recommendation.current_price === null) return null;
  const change = recommendation.price_change_pct;
  return (
    <Box sx={{ textAlign: "right" }}>
      <Typography sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {recommendation.current_price.toFixed(2)}
      </Typography>
      {change !== null && <ChangePill pct={change} />}
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
    <Panel sx={{ p: "14px", mt: 1.5 }}>
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
        <Box sx={{ mt: 1.5, pt: "11px", borderTop: "1px solid var(--line)" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "var(--muted)" }}>
            <Globe size={15} />
            <Typography sx={{ fontSize: 12 }}>Second opinion, from web search</Typography>
          </Box>
          <Typography sx={{ fontSize: 13, color: "var(--text2)", mt: 0.625 }}>{line}</Typography>
        </Box>
      )}
      <DecisionActions id={recommendation.id} onDecided={onDecided} />
    </Panel>
  );
}
