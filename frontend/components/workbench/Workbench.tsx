"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Box, Typography, useMediaQuery, useTheme } from "@mui/material";
import { Globe, Layers } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { listingText, sectorText } from "@/lib/discovery";
import { DecisionRail, DecisionSummary, PhoneActions } from "./DecisionRail";
import { Overview } from "./Overview";
import { SourcesTab } from "./SourcesTab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "sources", label: "Sources" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * The company page for a discovery idea: identity on top, the evidence in tabs, and a decision
 * rail that stays beside it (on a phone, the summary sits above the tabs and the actions ride
 * above the tab bar). Approve and Dismiss only record the decision.
 */
export function Workbench({ recommendation, onDecided }: { recommendation: DiscoveryRecommendation; onDecided: (updated: RecommendationOut) => void }) {
  const idea = recommendation.idea!;
  const isDesktop = useMediaQuery(useTheme().breakpoints.up("md"));
  const [tab, setTab] = useState<TabKey>("overview");
  const panelId = useId();
  const arrow = (e: KeyboardEvent) => {
    // The tab pattern: arrows (and Home/End) move between tabs, and only the selected one is a tab stop.
    const at = TABS.findIndex((t) => t.key === tab);
    const to = { ArrowRight: (at + 1) % TABS.length, ArrowLeft: (at + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    setTab(TABS[to].key);
    document.getElementById(`${panelId}-${TABS[to].key}-tab`)?.focus();
  };
  const country = idea.snapshot?.country;
  const sector = sectorText(idea);
  return (
    <Box sx={{ display: "grid", gap: 2, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
        <Logo name={idea.name} size={isDesktop ? 56 : 44} />
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" sx={{ fontSize: { xs: "1.375rem", md: "1.625rem" }, fontWeight: 650, letterSpacing: "-0.025em", lineHeight: 1.15 }}>
            {idea.name}
          </Typography>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)" }}>{listingText(idea)}</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 0.5, fontSize: "0.75rem", color: "var(--text2)" }}>
            {sector && (
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                <Layers size={13} aria-hidden /> {sector}
              </Box>
            )}
            {country && (
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                <Globe size={13} aria-hidden /> {country}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
      {!isDesktop && <DecisionSummary rec={recommendation} onSeeSources={() => setTab("sources")} />}
      <Box role="tablist" aria-label="Company sections" sx={{ display: "flex", gap: "4px", p: "4px", borderRadius: 999, bgcolor: "var(--track)", width: { xs: "100%", md: "max-content" }, maxWidth: "100%" }}>
        {TABS.map((t) => (
          <Box
            key={t.key}
            component="button"
            type="button"
            role="tab"
            id={`${panelId}-${t.key}-tab`}
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onKeyDown={arrow}
            aria-controls={`${panelId}-panel`}
            onClick={() => setTab(t.key)}
            sx={{
              flex: { xs: 1, md: "none" },
              minHeight: { xs: 44, md: 36 },
              px: { xs: 1, md: 2.25 },
              border: 0,
              borderRadius: 999,
              fontSize: { xs: "0.75rem", md: "0.8125rem" },
              fontWeight: 500,
              color: tab === t.key ? "var(--text)" : "var(--text2)",
              bgcolor: tab === t.key ? "var(--panel)" : "transparent",
              boxShadow: tab === t.key ? "var(--shadow)" : "none",
              cursor: "pointer",
            }}
          >
            {t.label}
          </Box>
        ))}
      </Box>
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) 300px" }, alignItems: "start" }}>
        <Box role="tabpanel" id={`${panelId}-panel`} aria-labelledby={`${panelId}-${tab}-tab`} sx={{ minWidth: 0 }}>
          {tab === "overview" ? <Overview idea={idea} recommendationId={recommendation.id} /> : <SourcesTab idea={idea} />}
        </Box>
        {isDesktop && <DecisionRail rec={recommendation} onDecided={onDecided} onSeeSources={() => setTab("sources")} />}
      </Box>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", maxWidth: "72ch", lineHeight: 1.5 }}>
        Advisory research for human review, not investment advice. Saving or approving only records your decision; nothing is sent to a broker.
      </Typography>
      {!isDesktop && <PhoneActions rec={recommendation} onDecided={onDecided} />}
    </Box>
  );
}
