"use client";

import Link from "next/link";
import useSWR from "swr";
import { Box, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";
import { formatPct } from "@/lib/format";
import { Amount } from "./Amount";
import { PortfolioChart } from "./PortfolioChart";

export function PortfolioTile() {
  const { data: summary } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { data: snapshots } = useSWR<Snapshot[]>("/portfolio/snapshots", apiFetch);

  // A side widget: while loading or on failure Today simply doesn't show it, rather than
  // flashing an error next to the page's real content.
  if (!summary) return null;

  const hasPositions = summary.holdings.some((h) => h.shares > 0);

  return (
    <Box sx={{ p: 2, border: "1px solid var(--line)", borderRadius: 2, mb: 2 }}>
      <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>Portfolio</Typography>
      {hasPositions ? (
        <>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            <Amount value={summary.total_market_value} size={26} />
            {summary.total_pl_pct !== null && (
              <Typography
                sx={{
                  fontSize: 12,
                  color: summary.total_pl_pct < 0 ? "var(--down)" : "var(--up)",
                }}
              >
                {formatPct(summary.total_pl_pct)}
              </Typography>
            )}
          </Box>
          <PortfolioChart snapshots={snapshots ?? []} variant="sparkline" />
          {summary.unpriced_count > 0 && (
            <Typography sx={{ fontSize: 12, color: "var(--warn)" }}>
              {summary.unpriced_count} not priced
            </Typography>
          )}
        </>
      ) : (
        <Typography sx={{ fontSize: 13, mt: 0.5 }}>
          Add your holdings in <Link href="/portfolio">Portfolio</Link>.
        </Typography>
      )}
    </Box>
  );
}
