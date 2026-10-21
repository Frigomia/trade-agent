"use client";

import { Box } from "@mui/material";
import type { AlertRow } from "@/lib/alerts";
import type { PortfolioAlerts as Typed } from "@/lib/api/alert-types";
import { PortfolioAlerts } from "./PortfolioAlerts";

/**
 * The desktop part of Today from the Soft mock: the Portfolio alerts panel. The portfolio value
 * chart, the three summary cards (portfolio, vs cost basis, awaiting you) and their data are not
 * part of the new Today; the portfolio's value and trend live on the Portfolio page.
 */
export function TodayDesktop({ rows, missing }: { rows: AlertRow[]; missing?: Typed["missing"] }) {
  return (
    <Box sx={{ mt: 1.75 }}>
      <PortfolioAlerts rows={rows} missing={missing} />
    </Box>
  );
}
