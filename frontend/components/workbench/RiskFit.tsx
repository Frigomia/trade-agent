import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { Panel } from "@/components/ui/Panel";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { fitScore } from "@/lib/discovery";
import { fitAssumption, fitFacts } from "@/lib/fitFacts";
import { eurCompact, formatMetric, riskFlag, sizeWord } from "@/lib/metrics";
import { BODY, H3 } from "./Cases";

const muted = { fontSize: "0.75rem", color: "var(--muted)" } as const;

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Panel component="section" sx={{ p: "20px", display: "grid", gap: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
        <Typography component="h3" sx={H3}>
          {title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {right}
      </Box>
      {children}
    </Panel>
  );
}

const percent = (fraction: number | null, digits = 0) => (fraction === null || !Number.isFinite(fraction) ? null : `${(fraction * 100).toFixed(digits)}%`);

function Row({ label, value, detail }: { label: string; value: string | null; detail: string }) {
  return (
    <Box sx={{ display: "grid", gap: 0.5, py: 1.25, borderTop: "1px solid var(--line)", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "150px minmax(0, 1fr)" }, "&:first-of-type": { borderTop: 0 } }}>
      <Box component="dt" sx={{ ...BODY, color: "var(--text2)" }}>{label}</Box>
      <Box component="dd" sx={{ m: 0, display: "grid" }}>
        <Typography component="b" sx={{ fontSize: "0.9375rem", fontWeight: 650, color: value ? "var(--text)" : "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          {value ?? "Not available"}
        </Typography>
        <Typography component="small" sx={muted}>{detail}</Typography>
      </Box>
    </Box>
  );
}

/** Measured, not scored: what the price and the market data show about how risky the company is. */
function Risk({ idea }: { idea: IdeaOut }) {
  const r = idea.risk;
  const debt = idea.snapshot?.fundamentals?.debtToEquity ?? idea.peers?.find((p) => p.metric === "debtToEquity")?.value ?? null;
  const size = r.size_bucket === "unknown" ? null : `${sizeWord(r.size_bucket)}${eurCompact(r.market_cap_eur) ? ` · ${eurCompact(r.market_cap_eur)}` : ""}`;
  const daily = eurCompact(r.avg_daily_value_eur);
  return (
    <Section title="Risk characteristics" right={<Typography sx={muted}>Measured, not scored</Typography>}>
      <Box component="dl" sx={{ m: 0 }}>
        <Row label="Volatility" value={percent(r.volatility_annualized) && `${percent(r.volatility_annualized)} a year`} detail="Annualised: how much the price has typically moved over a year." />
        <Row label="Biggest fall, last year" value={percent(r.max_drawdown_1y)} detail="From the peak to the lowest point within the past twelve months." />
        <Row label="Size" value={size} detail="Market value of the whole company." />
        <Row label="Liquidity" value={daily && `${daily} a day`} detail="Average value traded each day." />
        <Row label="Leverage" value={formatMetric("debtToEquity", debt)} detail="Debt to equity, as reported by the data provider." />
      </Box>
      {r.risk_flags.length > 0 ? (
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Typography component="h4" sx={{ fontSize: "0.75rem", fontWeight: 650, color: "var(--text2)" }}>
            Flags from the scan
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.25, display: "grid", gap: 0.5, ...BODY }}>
            {r.risk_flags.map((flag, i) => {
              const { title, detail } = riskFlag(flag);
              return (
                <li key={`${i}-${flag}`}>
                  <b>{title}</b>
                  {detail ? `: ${detail}` : ""}
                </li>
              );
            })}
          </Box>
        </Box>
      ) : (
        <Typography sx={muted}>The scan raised no risk flags.</Typography>
      )}
    </Section>
  );
}

/** How the company would sit in the user's portfolio: the computed score, and the written reading of it. */
function Fit({ idea }: { idea: IdeaOut }) {
  const fit = fitScore(idea);
  // The saved measurements and their notes do not depend on the score: the score needs every
  // measurement, while a partial set (a constant return series has no correlation) is still shown.
  const saved = idea.fit?.applicable ? idea.fit : null;
  const facts = saved ? fitFacts(saved, idea.snapshot?.sector) : [];
  return (
    <Section title="Portfolio fit">
      {fit === null ? (
        <Box sx={{ borderStyle: "dashed", borderWidth: "1px", borderColor: "var(--line2)", borderRadius: "14px", p: 2, display: "grid", gap: 0.5 }}>
          <Typography component="b" sx={{ fontSize: "1.25rem", fontWeight: 650 }}>
            {saved ? "Score unavailable" : "Not applicable"}
          </Typography>
          <Typography sx={BODY}>
            {saved
              ? "The fit score needs every measurement and could not be calculated for this idea. Any figures the scan did compute are listed below."
              : "Fit is measured against your holdings, and there was nothing to measure against when this idea was saved. Add holdings and the next scan calculates it."}
          </Typography>
        </Box>
      ) : (
        <Typography sx={BODY}>
          <Box component="b" sx={{ fontSize: "1.625rem", fontWeight: 650, letterSpacing: "-0.03em", color: "var(--text)" }}>{fit}</Box> fit, of 100 · computed
        </Typography>
      )}
      {saved && (facts.length > 0 || saved.notes.length > 0) && (
        <Box>
          {facts.length > 0 && (
            <>
              <Box component="dl" sx={{ m: 0 }}>
                {facts.map((f) => (
                  <Row key={f.label} label={f.label} value={f.value} detail={f.detail} />
                ))}
              </Box>
              <Typography sx={{ ...muted, mt: 1 }}>{fitAssumption(saved)}</Typography>
            </>
          )}
          {saved.notes.length > 0 && (
            <Box component="ul" sx={{ ...muted, m: 0, mt: 0.5, pl: 2.25 }}>
              {saved.notes.map((note, i) => (
                <li key={`${i}-${note}`}>{note}</li>
              ))}
            </Box>
          )}
        </Box>
      )}
      {idea.fit_summary && (
        <Box sx={{ borderStyle: "dashed", borderWidth: "1px", borderColor: "var(--line2)", borderRadius: "14px", p: "12px 14px", display: "grid", gap: 0.75 }}>
          <Typography sx={BODY}>{idea.fit_summary}</Typography>
          <Typography sx={muted}>AI research summary</Typography>
        </Box>
      )}
    </Section>
  );
}

/** The Risk and fit tab. */
export function RiskFit({ idea }: { idea: IdeaOut }) {
  return (
    <Box sx={{ display: "grid", gap: 2, minWidth: 0 }}>
      <Risk idea={idea} />
      <Fit idea={idea} />
    </Box>
  );
}
