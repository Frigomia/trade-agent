"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Box, Typography, Alert, useMediaQuery, useTheme } from "@mui/material";
import { ChevronLeft } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { AutomaticTag } from "@/components/recommendations/AutomaticTag";
import { PendingPill } from "@/components/recommendations/PendingPill";
import { ActionChip, ChangePill } from "@/components/recommendations/RecommendationCard";
import { Amount } from "@/components/portfolio/Amount";
import { Panel } from "@/components/ui/Panel";
import { AskAboutThis } from "@/components/recommendations/AskAboutThis";
import { DecisionActions } from "@/components/recommendations/DecisionActions";
import { EvidenceDetail } from "@/components/recommendations/EvidencePanel";
import { WebOpinionBox } from "@/components/recommendations/WebOpinionBox";
import { Workbench } from "@/components/workbench/Workbench";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import { ConfirmationPanel } from "@/components/recommendations/ConfirmationPanel";
import { RecommendationDetailDesktop } from "@/components/recommendations/RecommendationDetailDesktop";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

// The mockup's detail header: a quiet back link and the round theme toggle. Today lists only pending
// ideas, so a decided, withdrawn or redirected idea was reached from Discover and goes back there.
function BackRow({ toDiscover = false }: { toDiscover?: boolean }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
      <Box
        component={Link}
        href={toDiscover ? "/discover" : "/today"}
        sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, minHeight: 44, textDecoration: "none", color: "var(--muted)", fontSize: "0.8125rem" }}
      >
        <ChevronLeft size={18} />
        {toDiscover ? "Back to Discover" : "Today"}
      </Box>
      <Box sx={{ flex: 1 }} />
      <ThemeToggle />
    </Box>
  );
}

export default function RecommendationDetailPage() {
  // useSearchParams needs a Suspense boundary for the build.
  return (
    <Suspense fallback={<BackRow />}>
      <RecommendationDetail />
    </Suspense>
  );
}

/** The newer idea a superseded one points to, only when it is a plain positive integer (it goes into a URL). */
function validSuccessor(rec: RecommendationOut | undefined): number | null {
  const id = rec?.status === "SUPERSEDED" ? rec.successor_id : null;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A superseded idea opens its replacement. */
function openSuccessor(router: ReturnType<typeof useRouter>, successorId: number) {
  router.replace(`/today/${successorId}?from=superseded`);
}

function RecommendationDetail() {
  const fromSuperseded = useSearchParams().get("from") === "superseded";
  const isDesktop = useMediaQuery(useTheme().breakpoints.up("md"));
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // The id goes straight into an authenticated API path, so only ever accept a plain integer:
  // a crafted /today/..%2Fsomething link must not steer the request to a different route.
  const validId = /^\d+$/.test(id);
  const { data: recommendation, error: loadError, mutate } = useSWR<RecommendationOut>(
    validId ? `/analysis/recommendations/${id}` : null,
    apiFetch,
  );
  // A decision made in this visit shows the confirmation once; reopened later, a discovery idea shows
  // its company page with the decision instead. Client state, not a route, so a refresh drops it; kept
  // by id so it does not follow a client-side navigation to another idea.
  const [decidedId, setDecidedId] = useState<number | null>(null);
  const decidedHere = recommendation !== undefined && decidedId === recommendation.id;
  // A decision (or a changed decision) is written straight into the SWR cache — no separate
  // local copy to keep in sync with it. Only the decision fields are taken from the answer: the
  // approve and reject endpoints return a bare record (no live price, move or name), so replacing
  // the cached one would drop what the page loaded. A change made on a reopened page only updates it.
  const updateCached = (updated: RecommendationOut) =>
    void mutate(
      (cached) =>
        cached
          ? { ...cached, status: updated.status, reviewed_at: updated.reviewed_at, dismissal_reason: updated.dismissal_reason ?? null }
          : updated,
      { revalidate: false },
    );
  const setDecided = (updated: RecommendationOut) => {
    setDecidedId(updated.id);
    updateCached(updated);
  };
  const successorId = validSuccessor(recommendation);
  useEffect(() => {
    if (successorId !== null) openSuccessor(router, successorId);
  }, [router, successorId]);

  const decided = recommendation?.status === "APPROVED" || recommendation?.status === "REJECTED";
  const reopened = !!recommendation?.idea && ((decided && !decidedHere) || (recommendation.status === "SUPERSEDED" && !!recommendation.withdrawal));
  const body = (): ReactNode => {
    if (!validId || loadError) {
      return (
        <Alert severity="error">
          {!validId
            ? "Recommendation not found."
            : loadError instanceof ApiError
              ? loadError.detail
              : "Could not load this recommendation."}
        </Alert>
      );
    }

    if (!recommendation || successorId !== null) {
      return null; // loading, or on the way to the newer analysis
    }

    if (reopened) {
      return <Workbench recommendation={recommendation as DiscoveryRecommendation} onDecided={setDecided} onChanged={updateCached} />;
    }

    // Manual and scheduled runs always have a replacement; a discovery idea without its research says the same.
    if (recommendation.status === "SUPERSEDED") {
      return (
        <Alert severity="info">
          A newer analysis replaced this recommendation for {recommendation.ticker}.
        </Alert>
      );
    }

    if (recommendation.status !== "PENDING") {
      return (
        <ConfirmationPanel
          recommendation={recommendation}
          onChanged={setDecided}
          onBackToToday={() => router.push("/today")}
          onViewCompany={recommendation.idea ? () => setDecidedId(null) : undefined}
        />
      );
    }

    // A discovery idea gets the company page: the saved research in tabs beside a decision rail.
    if (recommendation.idea) {
      return <Workbench recommendation={recommendation as DiscoveryRecommendation} onDecided={setDecided} onChanged={updateCached} notice={fromSuperseded ? "newer" : undefined} />;
    }

    if (isDesktop) {
      return <RecommendationDetailDesktop recommendation={recommendation} onDecided={setDecided} />;
    }

    // Phone: the evidence first, the actions pinned to the bottom of the screen.
    return (
      <Box sx={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 190px)" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap", rowGap: 0.75 }}>
          <Typography sx={{ fontSize: "1.875rem", fontWeight: 650, letterSpacing: "-.03em" }}>
            {recommendation.ticker}
          </Typography>
          <ActionChip action={recommendation.action} />
          <AutomaticTag source={recommendation.source} />
          <Box sx={{ flex: 1 }} />
          <PendingPill />
        </Box>
        {recommendation.current_price !== null && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mt: 0.25 }}>
            <Amount value={recommendation.current_price} size={20} />
            {recommendation.price_change_pct !== null && <ChangePill pct={recommendation.price_change_pct} />}
          </Box>
        )}
        <EvidenceDetail recommendation={recommendation} />
        <AskAboutThis ticker={recommendation.ticker} action={recommendation.action} />
        {recommendation.ai_analysis && <WebOpinionBox text={recommendation.ai_analysis} />}
        {/* Stays just above the tab bar while a long analysis scrolls underneath. */}
        <Box sx={{ mt: "auto", pt: 2, pb: 1, position: "sticky", bottom: 64, zIndex: 1, bgcolor: "var(--bg)" }}>
          <Panel sx={{ p: "12px 12px 8px" }}>
            <DecisionActions id={recommendation.id} onDecided={setDecided} />
          </Panel>
        </Box>
      </Box>
    );
  };

  return (
    <>
      <BackRow toDiscover={fromSuperseded || reopened} />
      {body()}
    </>
  );
}
