"use client";

import Link from "next/link";
import useSWR from "swr";
import { Box, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";
import { formatPct } from "@/lib/format";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
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
    <Panel sx={{ p: "12px 13px", flex: 1, minWidth: 0 }}>
      <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Portfolio</Typography>
      {hasPositions ? (
        <>
          <Box sx={{ mt: 0.5 }}>
            <Amount value={summary.total_market_value} size={22} />
          </Box>
          {summary.total_pl_pct !== null && (
            <Box sx={{ mt: 0.75 }}>
              <Pill tone={summary.total_pl_pct < 0 ? "down" : "up"}>
                {formatPct(summary.total_pl_pct)}
              </Pill>
            </Box>
          )}
          <Box sx={{ display: { xs: "none", md: "block" }, mt: 1, color: "var(--up)" }}>
            <PortfolioChart snapshots={snapshots ?? []} variant="sparkline" />
          </Box>
          {summary.unpriced_count > 0 && (
            <Typography sx={{ fontSize: 12, color: "var(--warn)", mt: 0.5 }}>
              {summary.unpriced_count} not priced
            </Typography>
          )}
        </>
      ) : (
        <Typography sx={{ fontSize: 13, mt: 0.5 }}>
          Add your holdings in <Link href="/portfolio">Portfolio</Link>.
        </Typography>
      )}
    </Panel>
  );
}
