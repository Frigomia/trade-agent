"use client";

import type { ReactNode } from "react";
import { Box, Button, Typography } from "@mui/material";
import { ChevronDown } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { PortfolioAnalytics } from "@/lib/api/analytics-types";
import { formatShare } from "@/lib/format";
import { orderedPositions, riskFacts, spread } from "@/lib/portfolio/risk";

const muted = { fontSize: "0.75rem", color: "var(--muted)" } as const;
const visuallyHidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;
// Rounded first, then made positive-zero, so a tiny negative never reads "-0.00".
const corr = (n: number) => (Math.round(n * 100) / 100 + 0).toFixed(2);

function Metric({ label, value, detail }: { label: string; value: string | null; detail: string }) {
  return (
    <Box sx={{ bgcolor: "var(--track)", borderRadius: "14px", p: "12px 14px", display: "grid", gap: "2px", minWidth: 0 }}>
      <Typography component="small" sx={{ fontSize: "0.75rem", color: "var(--text2)" }}>
        {label}
      </Typography>
      <Box component="b" sx={{ fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.02em", color: value ? "var(--text)" : "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
        {value ?? "Not available"}
      </Box>
      <Typography component="em" sx={{ ...muted, fontStyle: "normal", lineHeight: 1.4 }}>
        {detail}
      </Typography>
    </Box>
  );
}

function Section({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Panel component="section" aria-label="Risk and analytics" sx={{ p: "20px 24px", display: "grid", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, flexWrap: "wrap" }}>
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
          Risk and analytics
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={muted}>Measured, not scored</Typography>
        {action}
      </Box>
      {children}
    </Panel>
  );
}

/** What could not be valued or measured, in the backend's own words, so a gap is never silent. */
function Gaps({ analytics }: { analytics: PortfolioAnalytics }) {
  const skipped = Object.entries(analytics.skipped);
  if (skipped.length === 0 && analytics.notes.length === 0) return null;
  return (
    <Box component="ul" sx={{ ...muted, m: 0, pl: 2.25, display: "grid", gap: 0.5 }}>
      {skipped.map(([ticker, why]) => (
        <li key={`skipped-${ticker}`}>
          {ticker} is left out: {why}
        </li>
      ))}
      {analytics.notes.map((note, i) => (
        <li key={`${i}-${note}`}>{note}</li>
      ))}
    </Box>
  );
}

/** The correlation table with the numbers printed: shading helps, but never carries the meaning alone. */
function CorrelationTable({ analytics }: { analytics: PortfolioAnalytics }) {
  const tickers = orderedPositions(analytics).map((p) => p.ticker);
  return (
    <Box sx={{ overflowX: "auto" }}>
      <Box component="table" aria-label="Correlation between holdings" sx={{ borderCollapse: "separate", borderSpacing: "2px", width: "100%", fontSize: "0.75rem" }}>
        <thead>
          <tr>
            <Box component="th" sx={visuallyHidden}>Holding</Box>
            {tickers.map((t) => (
              <Box component="th" scope="col" key={t} sx={{ fontWeight: 500, color: "var(--muted)", p: "2px 0", textAlign: "center" }}>
                {t}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickers.map((row) => (
            <tr key={row}>
              <Box component="th" scope="row" sx={{ fontWeight: 500, color: "var(--muted)", textAlign: "right", pr: 0.75 }}>
                {row}
              </Box>
              {tickers.map((col) => {
                const value = analytics.correlation[row]?.[col];
                const known = typeof value === "number" && Number.isFinite(value);
                const same = row === col;
                return (
                  <Box
                    component="td"
                    key={col}
                    sx={{
                      textAlign: "center",
                      height: 32,
                      minWidth: 40,
                      borderRadius: "6px",
                      fontVariantNumeric: "tabular-nums",
                      color: same || !known ? "var(--muted)" : "var(--text)",
                      bgcolor: same || !known ? "var(--track)" : `color-mix(in srgb, var(--accent) ${Math.max(0, value) * 45}%, var(--track))`,
                    }}
                  >
                    {known ? corr(value) : "—"}
                  </Box>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

/**
 * What is happening to figures already on screen: they are being read again (the figures are dimmed
 * and marked busy meanwhile), or that failed and they may be out of date. Shown above either layout,
 * including a cached "nothing could be valued", so a failed refresh always has its Try again. The
 * live region is always mounted, so a screen reader hears the text appear.
 */
function Status({ refreshFailed, updating, retrying, onRetry }: { refreshFailed: boolean; updating: boolean; retrying: boolean; onRetry: () => void }) {
  return (
    <>
      <Typography role="status" sx={{ ...muted, display: updating ? "block" : "none" }}>
        {updating ? "Updating these figures…" : ""}
      </Typography>
      {refreshFailed && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <Typography sx={{ ...muted, color: "var(--warn)" }}>These figures may be out of date: they could not be refreshed.</Typography>
          <Button size="small" disabled={retrying} onClick={onRetry}>
            {retrying ? "Trying again…" : "Try again"}
          </Button>
        </Box>
      )}
    </>
  );
}

/**
 * The Explorer's risk section: facts about the portfolio, measured from the daily price changes the
 * holdings have in common (the backend needs at least 60 matching days and looks back up to a year;
 * the screen never claims a full year) with values converted to euro, and never a score. Advanced analytics (the correlation table and the spread)
 * opens on demand. Anything the backend could not value or compute is said, not hidden.
 */
export function RiskPanel({
  analytics,
  failed,
  refreshFailed = false,
  retrying = false,
  onRetry,
}: {
  analytics: PortfolioAnalytics | undefined;
  failed: boolean;
  /** The figures shown are from before the last change, and reading them again failed. */
  refreshFailed?: boolean;
  /** The figures are being read (again): the first time there are none, later they stay on screen. */
  retrying?: boolean;
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <Section>
        <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)" }}>The risk figures could not be calculated right now.</Typography>
        <Box>
          <Button variant="outlined" disabled={retrying} onClick={onRetry}>
            {retrying ? "Trying again…" : "Try again"}
          </Button>
        </Box>
      </Section>
    );
  }
  // The skeleton is only for the very first read: while changed figures are read again the old ones stay.
  if (!analytics) {
    return (
      <Section>
        <Box aria-busy sx={{ height: 96, borderRadius: "14px", bgcolor: "var(--track)" }} />
      </Section>
    );
  }
  const updating = retrying && !refreshFailed;
  const status = <Status refreshFailed={refreshFailed} updating={updating} retrying={retrying} onRetry={onRetry} />;
  if (analytics.positions.length === 0) {
    return (
      <Section>
        {status}
        <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)" }}>No holding could be valued, so there is nothing to measure yet.</Typography>
        <Gaps analytics={analytics} />
      </Section>
    );
  }
  const facts = riskFacts(analytics);
  const spreadFacts = spread(analytics);
  const withHistory = Object.keys(analytics.correlation).length > 1;
  return (
    <Section>
      {status}
      {/* While the figures are read again the old ones stay, dimmed and marked busy: they may still
          include a holding that was just removed. */}
      <Box aria-busy={updating} sx={{ display: "grid", gap: 2, opacity: updating ? 0.55 : 1, transition: "opacity 120ms" }}>
      <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(3, minmax(0, 1fr))" } }}>
        <Metric label="Volatility" value={facts.volatility === null ? null : `${formatShare(facts.volatility)} a year`} detail={facts.volatility === null ? "Needs matching price history for every holding." : "Annualised, from the daily changes the holdings share."} />
        <Metric label="Largest position" value={facts.largest ? formatShare(facts.largest.weight) : null} detail={facts.largest?.name ?? "Nothing valued."} />
        <Metric label="Top three together" value={facts.topThree ? formatShare(facts.topThree.weight) : null} detail={facts.topThree ? facts.topThree.tickers.join(", ") : "Needs at least three holdings."} />
        <Metric label="Effective holdings" value={facts.effectiveHoldings === null ? null : facts.effectiveHoldings.toFixed(1)} detail="As if spread equally over this many." />
        <Metric
          label="Average correlation"
          value={facts.averageCorrelation === null ? null : corr(facts.averageCorrelation)}
          detail={facts.highestPair ? `Highest pair ${facts.highestPair.a} and ${facts.highestPair.b}, ${corr(facts.highestPair.value)}.` : "Needs two holdings with matching history."}
        />
        <Metric
          label="Biggest fall, last year"
          value={facts.biggestFall === null ? null : formatShare(facts.biggestFall)}
          detail={facts.biggestFall === null ? "Needs matching price history for every holding." : "From peak to low over the shared price history, up to a year, with today's holdings and weights."}
        />
      </Box>
      <Gaps analytics={analytics} />
      <Typography sx={muted}>Values are converted to euro, so these shares can differ a little from the table above.</Typography>

      <Box component="details" sx={{ "& > summary": { cursor: "pointer", listStyle: "none", display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: 44, fontSize: "0.8125rem", color: "var(--accent)", fontWeight: 500, "&::-webkit-details-marker": { display: "none" } }, "&[open] > summary svg": { transform: "rotate(180deg)" } }}>
        <summary>
          <ChevronDown size={14} aria-hidden />
          Advanced analytics
        </summary>
        <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { md: "minmax(0, 1.6fr) minmax(0, 1fr)" }, mt: 0.75 }}>
          <Box sx={{ display: "grid", gap: 1, minWidth: 0 }}>
            <Typography component="h3" sx={{ fontSize: "0.8125rem", fontWeight: 650 }}>
              Correlation between holdings
            </Typography>
            {withHistory ? (
              <>
                <CorrelationTable analytics={analytics} />
                <Typography sx={muted}>1.00 means two holdings moved together every day; 0 means no link. Darker is higher. Based on the daily changes each pair shares, at least 60 days.</Typography>
              </>
            ) : (
              <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)" }}>Correlation needs at least two holdings.</Typography>
            )}
          </Box>
          <Box sx={{ display: "grid", gap: 1, alignContent: "start" }}>
            <Typography component="h3" sx={{ fontSize: "0.8125rem", fontWeight: 650 }}>
              Spread
            </Typography>
            <Box component="dl" sx={{ m: 0, display: "grid" }}>
              {[
                ["Sectors", String(spreadFacts.sectors)],
                ["Countries", String(spreadFacts.countries)],
                ["Currencies", String(spreadFacts.currencies)],
                ...(spreadFacts.largestSector ? [["Largest sector", `${spreadFacts.largestSector.label}, ${formatShare(spreadFacts.largestSector.weight)}`]] : []),
                ...(spreadFacts.unclassifiedSector !== null ? [["Sector not known", formatShare(spreadFacts.unclassifiedSector)]] : []),
              ].map(([label, value]) => (
                <Box key={label} sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 0.75, borderTop: "1px solid var(--line)", fontSize: "0.8125rem", "&:first-of-type": { borderTop: 0 } }}>
                  <Box component="dt" sx={{ color: "var(--text2)" }}>{label}</Box>
                  <Box component="dd" sx={{ m: 0, fontWeight: 650, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{value}</Box>
                </Box>
              ))}
            </Box>
            <Typography sx={muted}>These are facts about the portfolio, not a rating. There is no overall health score.</Typography>
          </Box>
        </Box>
      </Box>
      </Box>
    </Section>
  );
}
