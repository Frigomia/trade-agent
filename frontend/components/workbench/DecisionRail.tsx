"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Box, Button, Typography } from "@mui/material";
import { Bookmark, Check, Clock, MessageSquare, X } from "lucide-react";
import { PriceBlock } from "@/components/discovery/PriceBlock";
import { Meter } from "@/components/ui/Meter";
import { Panel } from "@/components/ui/Panel";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { confidenceLabel, fitScore, meterFill, riskLabel, whenText } from "@/lib/discovery";
import { useDecision } from "@/lib/useDecision";

const NOTE = "Approving records your decision. Nothing is sent to a broker.";

/** Where "Ask AI" goes: Chat with the question already typed in. */
export const askHref = (name: string, ticker: string) =>
  `/chat?ask=${encodeURIComponent(`Walk me through the research on ${name} (${ticker}).`)}`;

function FitLine({ idea }: { idea: DiscoveryRecommendation["idea"] & object }) {
  const fit = fitScore(idea);
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "0.8125rem", color: "var(--text2)" }}>
      <span>Portfolio fit</span>
      {fit === null ? (
        <Box component="span" sx={{ fontWeight: 650, color: "var(--text)" }}>Not applicable</Box>
      ) : (
        <span>
          <Box component="b" sx={{ fontSize: "1.25rem", fontWeight: 650, color: "var(--text)" }}>{fit}</Box> of 100
        </span>
      )}
    </Box>
  );
}

/**
 * Price, confidence, risk and last analysis: what a decision rests on, in one block. On a phone it
 * also carries the fit and the way to the sources (the rail has its own).
 */
export function DecisionSummary({ rec, onSeeSources }: { rec: DiscoveryRecommendation; onSeeSources?: () => void }) {
  const idea = rec.idea!;
  const [now] = useState(() => Date.now()); // lazy: the purity lint forbids Date.now() in render
  return (
    <Box sx={{ display: "grid", gap: 1.5 }}>
      <Box sx={{ "& > div": { justifyItems: "start", textAlign: "left" } }}>
        <PriceBlock rec={rec} large />
      </Box>
      <Box sx={{ display: "grid", gap: 1, fontSize: "0.8125rem", color: "var(--text2)" }}>
        <Meter fill={meterFill(idea.confidence)} label={confidenceLabel(idea.confidence)} />
        <Meter fill={meterFill(idea.risk.risk_level)} label={riskLabel(idea.risk.risk_level)} />
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, color: "var(--muted)" }}>
          <Clock size={14} aria-hidden /> Last analysis {whenText(rec.created_at, now)}
        </Box>
      </Box>
      {onSeeSources && (
        <>
          <FitLine idea={idea} />
          <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)" }}>
            <span>
              {idea.sources.length} source{idea.sources.length === 1 ? "" : "s"}
            </span>
            <Box component="button" type="button" onClick={onSeeSources} sx={{ p: 0, minHeight: 44, border: 0, bgcolor: "transparent", color: "var(--accent)", fontSize: "inherit", cursor: "pointer" }}>
              See sources
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}

/**
 * The decision rail: the summary, the portfolio fit and the four actions. Approve and Dismiss only
 * record the decision; Save to Discover is shown disabled until Discover exists.
 */
export function DecisionRail({
  rec,
  onDecided,
  onSeeSources,
}: {
  rec: DiscoveryRecommendation;
  onDecided: (updated: RecommendationOut) => void;
  onSeeSources: () => void;
}) {
  const idea = rec.idea!;
  const { decide, submitting, error } = useDecision(rec.id, onDecided);
  return (
    <Panel component="aside" aria-label="Decision" sx={{ p: "20px", display: "grid", gap: 2, position: { md: "sticky" }, top: 16 }}>
      <DecisionSummary rec={rec} />
      <Box component="hr" sx={{ border: 0, borderTop: "1px solid var(--line)", m: 0 }} />
      <FitLine idea={idea} />
      <Box component="hr" sx={{ border: 0, borderTop: "1px solid var(--line)", m: 0 }} />
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={{ display: "grid", gap: 1 }}>
        <Button variant="contained" disabled={submitting} onClick={() => decide("approve")} startIcon={<Check size={16} aria-hidden />}>
          Approve
        </Button>
        <Button variant="outlined" disabled startIcon={<Bookmark size={16} aria-hidden />} aria-label="Save to Discover: coming soon" title="Coming soon">
          Save to Discover
        </Button>
        <Button variant="outlined" disabled={submitting} onClick={() => decide("reject")} startIcon={<X size={16} aria-hidden />}>
          Dismiss
        </Button>
        <Button component={Link} href={askHref(idea.name, idea.ticker)} variant="outlined" startIcon={<MessageSquare size={16} aria-hidden />}>
          Ask AI
        </Button>
      </Box>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", textAlign: "center" }}>{NOTE}</Typography>
      <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)" }}>
        <span>
          {idea.sources.length} source{idea.sources.length === 1 ? "" : "s"}
        </span>
        <Box component="button" type="button" onClick={onSeeSources} sx={{ p: 0, border: 0, bgcolor: "transparent", color: "var(--accent)", fontSize: "inherit", cursor: "pointer" }}>
          See sources
        </Box>
      </Box>
    </Panel>
  );
}

/** On a phone the actions ride above the tab bar: Approve, then Save, Dismiss and Ask as icon buttons. */
export function PhoneActions({ rec, onDecided }: { rec: DiscoveryRecommendation; onDecided: (updated: RecommendationOut) => void }) {
  const idea = rec.idea!;
  const { decide, submitting, error } = useDecision(rec.id, onDecided);
  return (
    <Box sx={{ position: "sticky", bottom: "var(--tabbar-h, 66px)", zIndex: 2, mx: -2, px: 2, py: 1.25, display: "grid", gap: 1, borderTop: "1px solid var(--line)", bgcolor: "var(--panel)" }}>
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 44px", gap: 1 }}>
        <Button variant="contained" disabled={submitting} onClick={() => decide("approve")} startIcon={<Check size={16} aria-hidden />} sx={{ minHeight: 44 }}>
          Approve
        </Button>
        <Button variant="outlined" disabled aria-label="Save to Discover: coming soon" sx={{ minWidth: 0, minHeight: 44, p: 0 }}>
          <Bookmark size={16} aria-hidden />
        </Button>
        <Button variant="outlined" disabled={submitting} onClick={() => decide("reject")} aria-label="Dismiss" sx={{ minWidth: 0, minHeight: 44, p: 0 }}>
          <X size={16} aria-hidden />
        </Button>
        <Button component={Link} href={askHref(idea.name, idea.ticker)} variant="outlined" aria-label="Ask AI" sx={{ minWidth: 0, minHeight: 44, p: 0 }}>
          <MessageSquare size={16} aria-hidden />
        </Button>
      </Box>
    </Box>
  );
}
