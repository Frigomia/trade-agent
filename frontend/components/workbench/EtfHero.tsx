import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { Check } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { confidenceLabel, fitScore } from "@/lib/discovery";
import { correlationWords, effectivePositions, ETF_GATE, gapParts, partsAgree, stripScale } from "@/lib/etfIdea";
import { formatShare } from "@/lib/format";
import { GapStrip } from "./GapStrip";

const isNum = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const tenth = (n: number) => Math.round(n * 10) / 10;

/** "0.9 points lower": the change between the two figures as shown, so the words always agree with the printed values. */
function change(before: number, after: number, unit: (n: string, dir: "up" | "down") => string): string {
  const d = tenth(tenth(after) - tenth(before));
  return Math.abs(d) < 0.05 ? "Unchanged" : unit(Math.abs(d).toFixed(1), d > 0 ? "up" : "down");
}

const key = (marker: ReactNode, text: string) => (
  <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
    {marker}
    {text}
  </Box>
);
const mark = { width: 12, height: 12, flex: "none", display: "inline-block" } as const;

/** The panel that tells an ETF idea as what it does to the portfolio: the gap score and one strip per measured part. */
export function EtfHero({ idea }: { idea: IdeaOut }) {
  const fit = idea.fit;
  const score = fitScore(idea);
  const parts = gapParts(fit);
  const showParts = partsAgree(parts, score);
  const qualifies = score !== null && score >= ETF_GATE && idea.confidence !== "low";

  const [volBefore, volAfter] = [fit?.portfolio_vol_before, fit?.portfolio_vol_after];
  const [effBefore, effAfter] = [effectivePositions(fit?.hhi_before), effectivePositions(fit?.hhi_after)];
  const corr = fit?.avg_correlation_to_portfolio;
  const volScale = isNum(volBefore) && isNum(volAfter) ? stripScale([volBefore, volAfter], 0.01) : null;
  const effScale = effBefore !== null && effAfter !== null ? stripScale([effBefore, effAfter], 1) : null;

  return (
    <Panel component="section" aria-label="If you add 5% of this fund" sx={{ p: { xs: "20px 16px 16px", md: "24px 24px 20px" } }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: { xs: "12px", md: "20px" }, alignItems: "start" }}>
        <Box>
          <Typography component="h2" sx={{ fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.25 }}>
            If you add 5% of this fund
          </Typography>
          <Typography sx={{ m: "6px 0 0", fontSize: "0.875rem", color: "var(--text2)", lineHeight: 1.5, maxWidth: "58ch" }}>
            Your portfolio now against the same portfolio with 5% in this fund and the other weights scaled down.
          </Typography>
        </Box>
        <Box sx={{ display: "grid", justifyItems: "end", textAlign: "right", gap: "2px" }}>
          <Typography component="small" sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            Gap score
          </Typography>
          {score === null ? (
            <Typography component="b" sx={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--muted)" }}>
              Not available
            </Typography>
          ) : (
            <Typography component="b" sx={{ fontSize: "2rem", fontWeight: 650, letterSpacing: "-0.035em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {score}
              <Box component="span" sx={{ ml: "4px", fontSize: "0.875rem", fontWeight: 400, letterSpacing: 0, color: "var(--muted)" }}>
                of 100
              </Box>
            </Typography>
          )}
          {qualifies ? (
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.75rem", fontWeight: 650, whiteSpace: "nowrap" }}>
              <Box component="i" sx={{ width: 16, height: 16, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "var(--text2)", color: "var(--panel)", flex: "none" }}>
                <Check size={10} strokeWidth={3} aria-hidden />
              </Box>
              Qualifies
            </Box>
          ) : (
            score !== null &&
            score >= ETF_GATE && (
              <Typography component="span" sx={{ fontSize: "0.75rem", color: "var(--text2)" }}>
                {confidenceLabel(idea.confidence)}
              </Typography>
            )
          )}
        </Box>
      </Box>

      {fit && (
        <Box aria-hidden sx={{ display: "flex", gap: { xs: "12px", md: "18px" }, flexWrap: "wrap", m: "16px 0 4px", fontSize: "0.75rem", color: "var(--text2)" }}>
          {key(<Box component="i" sx={{ ...mark, borderRadius: "50%", border: "2px solid var(--muted)", bgcolor: "var(--panel)" }} />, "Now")}
          {key(<Box component="i" sx={{ ...mark, borderRadius: "50%", bgcolor: "var(--accent)" }} />, `With 5% of ${idea.ticker}`)}
          {key(<Box component="i" sx={{ ...mark, width: 2, borderRadius: "1px", bgcolor: "var(--text2)" }} />, "Reference")}
        </Box>
      )}

      {isNum(volBefore) && isNum(volAfter) && volScale && (
        <GapStrip
          label="Portfolio volatility"
          caption="A year · lower is calmer"
          change={change(volBefore * 100, volAfter * 100, (n, dir) => `${n} points ${dir === "up" ? "higher" : "lower"}`)}
          now={volBefore}
          withFive={volAfter}
          nowText={formatShare(volBefore, 1)}
          withFiveText={formatShare(volAfter, 1)}
          scale={volScale}
          axis={[formatShare(volScale.min, 0), formatShare(volScale.max, 0)]}
          score={showParts ? parts.volatility : null}
        />
      )}
      {effBefore !== null && effAfter !== null && effScale && isNum(fit?.hhi_before) && isNum(fit?.hhi_after) && (
        <GapStrip
          label="Spread of your money"
          caption={`Effective positions · HHI ${fit.hhi_before.toFixed(2)} to ${fit.hhi_after.toFixed(2)}`}
          change={change(effBefore, effAfter, (n, dir) => `${n} ${dir === "up" ? "more" : "fewer"} effective positions`)}
          now={effBefore}
          withFive={effAfter}
          nowText={tenth(effBefore).toFixed(1)}
          withFiveText={tenth(effAfter).toFixed(1)}
          scale={effScale}
          score={showParts ? parts.concentration : null}
        />
      )}
      {isNum(corr) && (
        <GapStrip
          label="Moves with your holdings"
          caption="Average correlation · lower is better"
          change={correlationWords(corr)}
          now={1}
          withFive={corr}
          nowText="1.00"
          withFiveText={corr.toFixed(2)}
          scale={{ min: 0, max: 1 }}
          axis={["0", "1"]}
          reference={{ value: 1, text: "1.00" }}
          score={showParts ? parts.correlation : null}
        />
      )}

      <Box sx={{ pt: 2, borderTop: "1px solid var(--line)", fontSize: "0.875rem", color: "var(--text2)", lineHeight: 1.5 }}>
        <Typography sx={{ m: 0, maxWidth: "70ch", fontSize: "inherit", color: "inherit", lineHeight: "inherit" }}>
          {showParts && `The gap score is the mean of the three part scores (${parts.volatility}, ${parts.concentration} and ${parts.correlation}). `}
          {`An ETF qualifies at ${ETF_GATE} or more with medium or high confidence. Computed from prices; no AI text goes into it.`}
        </Typography>
      </Box>
    </Panel>
  );
}
