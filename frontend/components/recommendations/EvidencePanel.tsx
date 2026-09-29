import { Box, Typography, LinearProgress } from "@mui/material";
import type { RecommendationOut, TechnicalSignal } from "@/lib/api/recommendation-types";

const SIGNAL_LABEL: Record<TechnicalSignal, string> = {
  NEUTRAL: "Neutral",
  OVERSOLD: "Oversold",
  STRONG_UPTREND: "Strong uptrend",
  WEAK_DOWNTREND: "Weak downtrend",
};

// Matches the mockups' pill convention: oversold/strong-uptrend read as favorable (green),
// weak-downtrend as unfavorable (red), neutral as neither (muted).
const SIGNAL_COLOR: Record<TechnicalSignal, string> = {
  NEUTRAL: "var(--muted)",
  OVERSOLD: "var(--up)",
  STRONG_UPTREND: "var(--up)",
  WEAK_DOWNTREND: "var(--down)",
};

export function EvidencePanel({ recommendation }: { recommendation: RecommendationOut }) {
  const { fundamental_score, technical_signal, suggested_position_pct } = recommendation;

  return (
    <Box sx={{ mt: 1.5 }}>
      {fundamental_score !== null && (
        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>Fundamentals</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{fundamental_score}/100</Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={fundamental_score}
            sx={{ mt: 0.5, height: 6, borderRadius: 3 }}
          />
        </Box>
      )}
      {technical_signal !== null && (
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
          <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>Technical timing</Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: SIGNAL_COLOR[technical_signal] }}>
            {SIGNAL_LABEL[technical_signal]}
          </Typography>
        </Box>
      )}
      {suggested_position_pct !== null && (
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
          <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>Suggested size</Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
            {(suggested_position_pct * 100).toFixed(1)}% of portfolio
          </Typography>
        </Box>
      )}
    </Box>
  );
}
