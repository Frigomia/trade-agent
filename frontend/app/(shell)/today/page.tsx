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
import { PageHeader } from "@/components/shell/PageHeader";
import { TodayDesktop } from "@/components/recommendations/TodayDesktop";
import { useDailySnapshot } from "@/lib/portfolio/useDailySnapshot";
import { ClaudeRequired } from "@/components/claude/ClaudeRequired";
import { useClaudeLock } from "@/lib/claudeKey";
import { DiscoveryFeed } from "@/components/discovery/DiscoveryFeed";
import { alertRows, missingNote } from "@/lib/alerts";
import { holdingsOnly } from "@/lib/discovery";
import { useAlerts } from "@/lib/useAlerts";
import { PortfolioAlerts } from "@/components/recommendations/PortfolioAlerts";
import { useDiscovery } from "@/lib/useDiscovery";
import type { Usage } from "@/lib/usage";

export default function TodayPage() {
  const isDesktop = useMediaQuery(useTheme().breakpoints.up("md"));
  useDailySnapshot();
  const { data: recommendations, error: loadError, mutate } = useSWR<RecommendationOut[]>(
    "/analysis/recommendations?status=PENDING",
    apiFetch,
  );
  const { data: summary, error: summaryError } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { data: usage } = useSWR<Usage>("/me/usage", apiFetch);
  const [now] = useState(() => Date.now()); // lazy: the purity lint forbids Date.now() in render
  const { lock, markRequired } = useClaudeLock();
  const discovery = useDiscovery(markRequired);

  // The pending table also holds discovery ideas; the holdings list below shows only the rest.
  const pending = holdingsOnly(recommendations ?? []);
  // The panel's rows: the typed alerts once they load (calls, upcoming earnings, big moves), the
  // pending calls until then.
  const typed = useAlerts();
  const rows = alertRows(typed, pending);
  const otherRows = rows.filter((r) => r.kind !== "new_recommendation"); // a phone shows calls as cards
  // What could not be checked is said inside the alerts panel; when no panel is mounted (no rows,
  // or a phone with only call cards) it is said on its own, so a failed check never reads as quiet.
  const missing = missingNote(typed?.missing ?? []);
  const panelShown = isDesktop ? rows.length > 0 : otherRows.length > 0;

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
      <DriftCard />
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load recommendations.
        </Alert>
      )}
      {missing && !panelShown && (
        <Typography sx={{ mt: 2, fontSize: "0.8125rem", color: "var(--text2)" }}>
          {missing}
        </Typography>
      )}
      {recommendations && pending.length === 0 && emptyKind !== null && (
        <TodayEmpty firstRun={emptyKind === "first-run"} />
      )}
      {!isDesktop && otherRows.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <PortfolioAlerts rows={otherRows} missing={typed?.missing} />
        </Box>
      )}
      {!isDesktop && pending.length > 0 && (
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em", mt: 3 }}>
          {otherRows.length > 0 ? "New recommendations" : "Portfolio alerts"}
        </Typography>
      )}
      {isDesktop && rows.length > 0 && <TodayDesktop rows={rows} missing={typed?.missing} />}
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
