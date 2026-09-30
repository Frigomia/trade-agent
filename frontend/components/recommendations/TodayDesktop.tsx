"use client";

import Link from "next/link";
import useSWR from "swr";
import { Box, Button, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { formatPct, formatSigned } from "@/lib/format";
import { PortfolioChart } from "@/components/portfolio/PortfolioChart";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { SIGNAL_LABEL } from "./EvidencePanel";
import { ActionChip } from "./RecommendationCard";

/** The desktop part of Today from the mockup: value over time beside the compact review list. */
export function TodayDesktop({ recommendations }: { recommendations: RecommendationOut[] }) {
  const { data: snapshots } = useSWR<Snapshot[]>("/portfolio/snapshots", apiFetch);

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.65fr) minmax(0, 1fr)",
        gap: 1.75,
        mt: 1.75,
        alignItems: "start",
      }}
    >
      <Panel sx={{ p: "18px 20px" }}>
        <Typography sx={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.01em", mb: 0.5 }}>
          Portfolio value
        </Typography>
        <PortfolioChart snapshots={snapshots ?? []} />
      </Panel>
      <Panel sx={{ p: "16px 18px" }}>
        <Box sx={{ display: "flex", alignItems: "baseline" }}>
          <Typography sx={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.01em" }}>
            To review
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
            {recommendations.length} pending
          </Typography>
        </Box>
        <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, mt: 1 }}>
          {recommendations.map((rec) => (
            <Box
              component="li"
              key={rec.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                py: 1.25,
                borderBottom: "1px solid var(--line)",
                "&:last-of-type": { borderBottom: 0 },
              }}
            >
              <Link
                href={`/today/${rec.id}`}
                style={{ color: "inherit", textDecoration: "none", flex: 1, minWidth: 0 }}
              >
                <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{rec.ticker}</Typography>
                <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
                  {[
                    rec.fundamental_score !== null ? `Fundamentals ${rec.fundamental_score}` : null,
                    rec.technical_signal ? SIGNAL_LABEL[rec.technical_signal].toLowerCase() : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Open for the evidence"}
                </Typography>
              </Link>
              <ActionChip action={rec.action} />
            </Box>
          ))}
        </Box>
        {recommendations.length > 0 && (
          <Button
            component={Link}
            href={`/today/${recommendations[0].id}`}
            variant="contained"
            fullWidth
            sx={{ mt: 1.5 }}
          >
            Review first
          </Button>
        )}
      </Panel>
    </Box>
  );
}

/** The desktop-only "vs cost basis" tile next to the portfolio value. */
export function CostBasisTile() {
  const { data: summary } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  if (!summary || !summary.holdings.some((h) => h.shares > 0)) return null;
  const tone = summary.total_pl < 0 ? "down" : "up";
  return (
    <Panel sx={{ p: "12px 13px", flex: 1, minWidth: 0 }}>
      <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Vs cost basis</Typography>
      <Typography
        sx={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.035em", mt: 0.5, fontVariantNumeric: "tabular-nums" }}
      >
        {formatSigned(summary.total_pl)}
      </Typography>
      {summary.total_pl_pct !== null && (
        <Box sx={{ mt: 0.75 }}>
          <Pill tone={tone}>{formatPct(summary.total_pl_pct)}</Pill>
        </Box>
      )}
    </Panel>
  );
}
