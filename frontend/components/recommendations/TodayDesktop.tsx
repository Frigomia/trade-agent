"use client";

import { Box } from "@mui/material";
import type { AlertRow } from "@/lib/alerts";
import type { PortfolioAlerts as Typed } from "@/lib/api/alert-types";
import type { WatchlistInsights as Insights } from "@/lib/api/insight-types";
import { PortfolioAlerts } from "./PortfolioAlerts";
import { WatchlistInsights } from "./WatchlistInsights";

/**
 * The desktop part of Today from the Soft mock: the Portfolio alerts and Watchlist insights panels
 * side by side, or one full-width when only one has anything to show. The portfolio value chart,
 * the three summary cards (portfolio, vs cost basis, awaiting you) and their data are not part of
 * the new Today; the portfolio's value and trend live on the Portfolio page.
 */
export function TodayDesktop({ rows, missing, insights }: { rows: AlertRow[]; missing?: Typed["missing"]; insights?: Insights }) {
  const watch = insights && insights.insights.length > 0 ? insights : undefined;
  const both = rows.length > 0 && watch !== undefined;
  return (
    <Box sx={{ mt: 1.75, display: "grid", gap: 2, gridTemplateColumns: both ? "repeat(2, minmax(0, 1fr))" : "1fr", alignItems: "start" }}>
      {rows.length > 0 && <PortfolioAlerts rows={rows} missing={missing} />}
      {watch && <WatchlistInsights insights={watch.insights} missing={watch.missing} />}
    </Box>
  );
}
