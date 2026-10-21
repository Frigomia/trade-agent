"use client";

import { Box } from "@mui/material";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { PortfolioAlerts } from "./PortfolioAlerts";

/**
 * The desktop part of Today from the Soft mock: the Portfolio alerts panel. The portfolio value
 * chart, the three summary cards (portfolio, vs cost basis, awaiting you) and their data are not
 * part of the new Today; the portfolio's value and trend live on the Portfolio page.
 */
export function TodayDesktop({ recommendations }: { recommendations: RecommendationOut[] }) {
  return (
    <Box sx={{ mt: 1.75 }}>
      <PortfolioAlerts recommendations={recommendations} />
    </Box>
  );
}
