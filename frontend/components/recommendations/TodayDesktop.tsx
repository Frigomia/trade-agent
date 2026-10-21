"use client";

import useSWR from "swr";
import { Box, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { formatPct, formatSigned } from "@/lib/format";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { PortfolioAlerts } from "./PortfolioAlerts";

/**
 * The desktop part of Today from the Soft mock: the Portfolio alerts panel. The portfolio value
 * chart that used to sit beside it is not part of the new Today; the value and its trend are in the
 * tile above and on the Portfolio page.
 */
export function TodayDesktop({ recommendations }: { recommendations: RecommendationOut[] }) {
  return (
    <Box sx={{ mt: 1.75 }}>
      <PortfolioAlerts recommendations={recommendations} />
    </Box>
  );
}

/** The desktop-only "vs cost basis" tile next to the portfolio value. */
export function CostBasisTile() {
  const { data: summary } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  if (!summary || !summary.holdings.some((h) => h.shares > 0)) return null;
  const hasProfit = summary.pl_covered_count !== 0;
  const tone = summary.total_pl < 0 ? "down" : "up";
  return (
    <Panel sx={{ p: "12px 13px", flex: 1, minWidth: 0 }}>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Vs cost basis</Typography>
      <Typography
        sx={{ fontSize: "1.375rem", fontWeight: 650, letterSpacing: "-0.035em", mt: 0.5, fontVariantNumeric: "tabular-nums" }}
      >
        {hasProfit ? formatSigned(summary.total_pl) : "\u2014"}
      </Typography>
      {hasProfit && summary.total_pl_pct !== null && (
        <Box sx={{ mt: 0.75 }}>
          <Pill tone={tone}>{formatPct(summary.total_pl_pct)}</Pill>
        </Box>
      )}
      {summary.pl_complete === false && (
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", mt: 0.75 }}>
          {hasProfit ? "P/L covers priced holdings with known costs." : "P/L unavailable until purchase costs and prices are known."}
        </Typography>
      )}
    </Panel>
  );
}
