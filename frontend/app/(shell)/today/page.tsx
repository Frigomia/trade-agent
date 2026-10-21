"use client";

import { useState } from "react";
import useSWR from "swr";
import { Box, Typography, Alert, useMediaQuery, useTheme } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import { TodayEmpty } from "@/components/recommendations/TodayEmpty";
import { RecommendationCard } from "@/components/recommendations/RecommendationCard";
import { DriftCard } from "@/components/plan/DriftCard";
import { PortfolioTile } from "@/components/portfolio/PortfolioTile";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { CostBasisTile, TodayDesktop } from "@/components/recommendations/TodayDesktop";
import { useDailySnapshot } from "@/lib/portfolio/useDailySnapshot";
import { ClaudeRequired } from "@/components/claude/ClaudeRequired";
import { useClaudeLock } from "@/lib/claudeKey";
import { DiscoveryFeed } from "@/components/discovery/DiscoveryFeed";
import { holdingsOnly } from "@/lib/discovery";
import { useDiscovery } from "@/lib/useDiscovery";
import type { Usage } from "@/lib/usage";

const ACTION_ORDER = ["BUY", "ADD", "HOLD", "TRIM", "SELL", "WATCH"] as const;

function AwaitingTile({ recommendations }: { recommendations: RecommendationOut[] }) {
  const parts = ACTION_ORDER.flatMap((action) => {
    const count = recommendations.filter((r) => r.action === action).length;
    return count > 0 ? [`${count} ${action}`] : [];
  });
  return (
    <Panel sx={{ p: "12px 13px", flex: 1, minWidth: 0 }}>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Awaiting you</Typography>
      <Typography sx={{ fontSize: "1.375rem", fontWeight: 650, letterSpacing: "-0.035em", mt: 0.5 }}>
        {recommendations.length}
      </Typography>
      {parts.length > 0 && (
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", mt: 1 }}>{parts.join(" · ")}</Typography>
      )}
    </Panel>
  );
}

export default function TodayPage() {
  const isDesktop = useMediaQuery(useTheme().breakpoints.up("md"));
  useDailySnapshot();
  const { data: recommendations, error: loadError, mutate } = useSWR<RecommendationOut[]>(
    "/analysis/recommendations?status=PENDING",
    apiFetch,
  );
  // Same key as PortfolioTile, so SWR shares one request.
  const { data: summary, error: summaryError } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { data: usage } = useSWR<Usage>("/me/usage", apiFetch);
  const [now] = useState(() => Date.now()); // lazy: the purity lint forbids Date.now() in render
  const { lock, markRequired } = useClaudeLock();
  const discovery = useDiscovery(markRequired);

  // The pending table also holds discovery ideas; the holdings list below shows only the rest.
  const pending = holdingsOnly(recommendations ?? []);

  // Nothing is pending. Someone with no holdings and no watchlist gets the first steps, everyone else
  // the all-clear. While the portfolio is still loading neither shows, so the wrong one never flashes;
  // if it fails to load the all-clear is the safe, truthful default.
  let emptyKind: "first-run" | "all-clear" | null = null;
  if (summary) {
    const hasPortfolio = summary.holdings.some((h) => h.shares > 0) || summary.watchlist.length > 0;
    emptyKind = hasPortfolio ? "all-clear" : "first-run";
  } else if (summaryError) {
    emptyKind = "all-clear";
  }

  return (
    <Box>
      <PageHeader title="Today" subtitle="Your latest research ideas and what needs attention on your holdings." />
      {lock && (
        <>
          <ClaudeRequired variant="today" lock={lock} />
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)", mb: 1.5 }}>
            {lock === "reconnect" ? "Reconnect Claude to run a scan" : "Connect Claude to run a scan"}. Everything else works
            without it.
          </Typography>
        </>
      )}
      <DiscoveryFeed
        ideas={discovery.ideas}
        loadError={discovery.loadError}
        job={discovery.job}
        running={discovery.running}
        startError={discovery.startError}
        progressUnavailable={discovery.progressUnavailable}
        lost={discovery.lost}
        onRecheck={discovery.recheck}
        usage={usage?.analysis_runs}
        locked={lock !== null}
        now={now}
        onRun={discovery.start}
      />
      <Box sx={{ display: "flex", gap: 1.25, mt: 3 }}>
        <PortfolioTile />
        {isDesktop && <CostBasisTile />}
        <AwaitingTile recommendations={pending} />
      </Box>
      <DriftCard />
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load recommendations.
        </Alert>
      )}
      {recommendations && pending.length === 0 && emptyKind !== null && (
        <TodayEmpty firstRun={emptyKind === "first-run"} />
      )}
      {!isDesktop && pending.length > 0 && (
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em", mt: 3 }}>
          Portfolio alerts
        </Typography>
      )}
      {isDesktop && pending.length > 0 && <TodayDesktop recommendations={pending} />}
      {!isDesktop &&
        pending.map((recommendation) => (
          // No inline confirmation here: approving or dismissing just revalidates the list, and the
          // card disappears because it is no longer PENDING. The "Decision recorded" screen is the
          // detail page's job (/today/[id]).
          <RecommendationCard key={recommendation.id} recommendation={recommendation} onDecided={() => mutate()} />
        ))}
    </Box>
  );
}
