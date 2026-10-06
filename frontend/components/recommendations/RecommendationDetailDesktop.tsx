"use client";

import { Box, LinearProgress, Typography } from "@mui/material";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { Amount } from "@/components/portfolio/Amount";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { AskAboutThis } from "./AskAboutThis";
import { AutomaticTag } from "./AutomaticTag";
import { DecisionActions } from "./DecisionActions";
import { SIGNAL_LABEL, SIGNAL_TONE } from "./EvidencePanel";
import { ActionChip, ChangePill } from "./RecommendationCard";
import { WebOpinionBox } from "./WebOpinionBox";

const BIG = { fontSize: 26, fontWeight: 650, letterSpacing: "-0.03em", lineHeight: 1.2 } as const;

/**
 * The desktop detail page: one centred column. A hero panel holds the call, the price and the
 * evidence; the web second opinion reads below it as an article; Approve and Dismiss ride in a
 * bar that stays at the bottom of the screen while you read.
 */
export function RecommendationDetailDesktop({
  recommendation,
  onDecided,
}: {
  recommendation: RecommendationOut;
  onDecided: (updated: RecommendationOut) => void;
}) {
  const { fundamental_score, technical_signal, suggested_position_pct } = recommendation;

  return (
    <Box sx={{ maxWidth: 760, mx: "auto", pb: 1 }}>
      <Panel sx={{ p: "24px 28px" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography sx={{ fontSize: 38, fontWeight: 650, letterSpacing: "-0.035em" }}>
            {recommendation.ticker}
          </Typography>
          <ActionChip action={recommendation.action} />
          <AutomaticTag source={recommendation.source} />
          <Box sx={{ flex: 1 }} />
          <Pill tone="warn">Pending</Pill>
        </Box>
        {recommendation.current_price !== null && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mt: 0.5 }}>
            <Amount value={recommendation.current_price} size={24} />
            {recommendation.price_change_pct !== null && <ChangePill pct={recommendation.price_change_pct} />}
          </Box>
        )}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "1.3fr 1fr 1fr",
            gap: 2.5,
            mt: 2.25,
            pt: 2,
            borderTop: "1px solid var(--line)",
          }}
        >
          <Box>
            <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Fundamentals</Typography>
            {fundamental_score !== null ? (
              <>
                <Typography sx={BIG}>
                  {fundamental_score}
                  <Box component="span" sx={{ fontSize: 13, fontWeight: 400, color: "var(--muted)", letterSpacing: 0 }}>
                    {" "}/100
                  </Box>
                </Typography>
                <LinearProgress variant="determinate" value={fundamental_score} sx={{ mt: 1 }} />
              </>
            ) : (
              <Typography sx={BIG}>—</Typography>
            )}
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Technical timing</Typography>
            <Box sx={{ mt: 1 }}>
              {technical_signal ? (
                <Pill tone={SIGNAL_TONE[technical_signal]}>{SIGNAL_LABEL[technical_signal]}</Pill>
              ) : (
                <Typography>—</Typography>
              )}
            </Box>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Suggested position</Typography>
            <Typography sx={BIG}>
              {suggested_position_pct !== null ? `${(suggested_position_pct * 100).toFixed(1)}%` : "—"}
            </Typography>
          </Box>
        </Box>
      </Panel>

      <AskAboutThis ticker={recommendation.ticker} action={recommendation.action} />

      {recommendation.ai_analysis && <WebOpinionBox text={recommendation.ai_analysis} article />}

      <Panel
        sx={{
          position: "sticky",
          bottom: 24,
          mt: 3,
          p: "14px 18px",
          bgcolor: "var(--tab-bg)",
          backdropFilter: "blur(18px)",
        }}
      >
        <DecisionActions id={recommendation.id} onDecided={onDecided} title={`Your decision on ${recommendation.ticker}`} />
      </Panel>
    </Box>
  );
}
