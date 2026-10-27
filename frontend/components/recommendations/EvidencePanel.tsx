import { Box, Typography } from "@mui/material";
import { Bar } from "@/components/ui/Bar";
import type { RecommendationOut, TechnicalSignal } from "@/lib/api/recommendation-types";
import { Panel } from "@/components/ui/Panel";
import { formatShare } from "@/lib/format";
import { Pill, type PillTone } from "@/components/ui/Pill";

export const SIGNAL_LABEL: Record<TechnicalSignal, string> = {
  NEUTRAL: "Neutral",
  OVERSOLD: "Oversold",
  STRONG_UPTREND: "Strong uptrend",
  WEAK_DOWNTREND: "Weak downtrend",
};

// A signal is a status, not a price move, so it never uses green or red (DESIGN.md): favorable reads
// as the accent, unfavorable as a caution, neutral as muted. The word is always shown.
export const SIGNAL_TONE: Record<TechnicalSignal, PillTone> = {
  NEUTRAL: "mute",
  OVERSOLD: "accent",
  STRONG_UPTREND: "accent",
  WEAK_DOWNTREND: "warn",
};

/** A fundamentals score under this reads as a caution (an amber bar and pill); the number is always shown. */
export const FUNDAMENTALS_CAUTION = 60;

const ROW = { display: "flex", alignItems: "center", gap: 1.5, minHeight: 56, py: 1, borderBottom: "1px solid var(--line)", "&:last-of-type": { borderBottom: 0 } };

// The detail page's version: one panel, a row per kind of evidence, the number as a pill.
export function EvidenceDetail({ recommendation }: { recommendation: RecommendationOut }) {
  const { fundamental_score, technical_signal, suggested_position_pct } = recommendation;
  return (
    <Panel sx={{ p: "2px 16px", mt: 1.5, "& > div": ROW }}>
      {fundamental_score !== null && (
        <Box>
          <Typography sx={{ fontWeight: 600, flex: 1 }}>Fundamentals</Typography>
          <Pill tone={fundamental_score < FUNDAMENTALS_CAUTION ? "warn" : "accent"}>{fundamental_score}/100</Pill>
        </Box>
      )}
      {technical_signal !== null && (
        <Box>
          <Typography sx={{ fontWeight: 600, flex: 1 }}>Technical timing</Typography>
          <Pill tone={SIGNAL_TONE[technical_signal]}>{SIGNAL_LABEL[technical_signal]}</Pill>
        </Box>
      )}
      {suggested_position_pct !== null && (
        <Box>
          <Typography sx={{ fontWeight: 600, flex: 1 }}>Suggested position</Typography>
          <Typography sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {formatShare(suggested_position_pct)} of portfolio
          </Typography>
        </Box>
      )}
    </Panel>
  );
}

export function EvidencePanel({ recommendation }: { recommendation: RecommendationOut }) {
  const { fundamental_score, technical_signal, suggested_position_pct } = recommendation;

  return (
    <Box sx={{ mt: 1.5 }}>
      {fundamental_score !== null && (
        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Fundamentals</Typography>
            <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {fundamental_score}/100
            </Typography>
          </Box>
          <Bar value={fundamental_score} label="Fundamentals" caution={fundamental_score < FUNDAMENTALS_CAUTION} sx={{ mt: 0.75 }} />
        </Box>
      )}
      {technical_signal !== null && (
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 1.25 }}>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Technical timing</Typography>
          <Pill tone={SIGNAL_TONE[technical_signal]}>{SIGNAL_LABEL[technical_signal]}</Pill>
        </Box>
      )}
      {suggested_position_pct !== null && (
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Suggested size</Typography>
          <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600 }}>
            {formatShare(suggested_position_pct)} of portfolio
          </Typography>
        </Box>
      )}
    </Box>
  );
}
