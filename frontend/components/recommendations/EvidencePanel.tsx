import { Box, Typography, LinearProgress } from "@mui/material";
import type { RecommendationOut, TechnicalSignal } from "@/lib/api/recommendation-types";
import { Pill, type PillTone } from "@/components/ui/Pill";

const SIGNAL_LABEL: Record<TechnicalSignal, string> = {
  NEUTRAL: "Neutral",
  OVERSOLD: "Oversold",
  STRONG_UPTREND: "Strong uptrend",
  WEAK_DOWNTREND: "Weak downtrend",
};

// Matches the mockups' pill convention: oversold/strong-uptrend read as favorable (green),
// weak-downtrend as unfavorable (red), neutral as neither (muted). The word is always shown.
const SIGNAL_TONE: Record<TechnicalSignal, PillTone> = {
  NEUTRAL: "mute",
  OVERSOLD: "up",
  STRONG_UPTREND: "up",
  WEAK_DOWNTREND: "down",
};

export function EvidencePanel({ recommendation }: { recommendation: RecommendationOut }) {
  const { fundamental_score, technical_signal, suggested_position_pct } = recommendation;

  return (
    <Box sx={{ mt: 1.5 }}>
      {fundamental_score !== null && (
        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Fundamentals</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {fundamental_score}/100
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={fundamental_score}
            sx={{ mt: 0.75 }}
          />
        </Box>
      )}
      {technical_signal !== null && (
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 1.25 }}>
          <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Technical timing</Typography>
          <Pill tone={SIGNAL_TONE[technical_signal]}>{SIGNAL_LABEL[technical_signal]}</Pill>
        </Box>
      )}
      {suggested_position_pct !== null && (
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
          <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Suggested size</Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
            {(suggested_position_pct * 100).toFixed(1)}% of portfolio
          </Typography>
        </Box>
      )}
    </Box>
  );
}
