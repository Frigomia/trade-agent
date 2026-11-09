"use client";

import Link from "next/link";
import { useState } from "react";
import { DismissSheet } from "@/components/recommendations/DismissSheet";
import { Alert, Box, Button, Typography } from "@mui/material";
import { Bookmark, Check, Clock, MessageSquare, X } from "lucide-react";
import { PriceBlock } from "@/components/discovery/PriceBlock";
import { Change } from "@/components/ui/Change";
import { Meter } from "@/components/ui/Meter";
import { Panel } from "@/components/ui/Panel";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { moveSinceRecommended } from "@/lib/decisionView";
import { confidenceLabel, dateTimeText, dayText, fitScore, meterFill, riskLabel } from "@/lib/discovery";
import { formatAmount } from "@/lib/format";
import { useDecision } from "@/lib/useDecision";
import { useSaveToDiscover } from "@/lib/useSaveToDiscover";

const NOTE = "Approving records your decision. Nothing is sent to a broker.";

/** Where "Ask AI" goes: Chat, which types the question about this saved idea and sends nothing. */
export const askHref = (ideaId: number) => `/chat?idea=${ideaId}`;

export function FitLine({ idea }: { idea: DiscoveryRecommendation["idea"] & object }) {
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

/** "3 sources · See sources" at the foot of a rail, opening the Sources tab. */
export function SourcesRow({ idea, onSeeSources }: { idea: DiscoveryRecommendation["idea"] & object; onSeeSources: () => void }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)" }}>
      <span>
        {idea.sources.length} source{idea.sources.length === 1 ? "" : "s"}
      </span>
      <Box component="button" type="button" onClick={onSeeSources} sx={{ p: 0, border: 0, bgcolor: "transparent", color: "var(--accent)", fontSize: "inherit", cursor: "pointer" }}>
        See sources
      </Box>
    </Box>
  );
}

const money = (rec: DiscoveryRecommendation, value: number) => `${rec.idea?.snapshot?.currency ?? ""} ${formatAmount(value)}`.trim();

/** Where the price is now: the live quote with its day change. Both are in the idea's major unit. */
function LivePrice({ rec, price }: { rec: DiscoveryRecommendation; price: number }) {
  return (
    <Box sx={{ display: "grid", gap: "0.125rem" }}>
      <Box component="span" sx={{ fontWeight: 650, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.035em", fontSize: { xs: "1.5rem", md: "1.875rem" }, lineHeight: 1.1 }}>
        {money(rec, price)}
      </Box>
      {rec.price_change_pct !== null && (
        <Box component="span" sx={{ fontSize: "0.8125rem" }}>
          <Change pct={rec.price_change_pct} /> today
        </Box>
      )}
    </Box>
  );
}

/** "Recommended 20 Oct 2026 · USD 176.40 +4.4% since"; nothing when either price is missing. Green and red mark only the move. */
export function SinceRecommended({ rec }: { rec: DiscoveryRecommendation }) {
  const move = moveSinceRecommended(rec);
  if (move === null) return null;
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", columnGap: 1.5, rowGap: 0.5, fontSize: "0.8125rem", color: "var(--text2)" }}>
      <span>Recommended {dayText(rec.created_at)}</span>
      <Box component="span" sx={{ display: "inline-flex", alignItems: "baseline", gap: 0.75 }}>
        <Box component="b" sx={{ fontWeight: 650, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{money(rec, rec.price_at_recommendation!)}</Box>
        <Change pct={move} />
        <span>since</span>
      </Box>
    </Box>
  );
}

/**
 * Price, confidence, risk and last analysis: what a decision rests on, in one block. On a phone it
 * also carries the fit and the way to the sources (the rail has its own). `showSince` is for a
 * reopened idea: the live price when a positive one loaded (else the dated scan quote) and the move since.
 */
export function DecisionSummary({ rec, onSeeSources, showSince = false }: { rec: DiscoveryRecommendation; onSeeSources?: () => void; showSince?: boolean }) {
  const idea = rec.idea!;
  return (
    <Box sx={{ display: "grid", gap: 1.5 }}>
      <Box sx={{ "& > div": { justifyItems: "start", textAlign: "left" } }}>
        {/* A zero or negative quote is not a price: fall back to the dated scan quote. */}
        {showSince && rec.current_price !== null && rec.current_price > 0 ? <LivePrice rec={rec} price={rec.current_price} /> : <PriceBlock rec={rec} large />}
      </Box>
      {showSince && <SinceRecommended rec={rec} />}
      <Box sx={{ display: "grid", gap: 1, fontSize: "0.8125rem", color: "var(--text2)" }}>
        <Meter fill={meterFill(idea.confidence)} label={confidenceLabel(idea.confidence)} />
        <Meter fill={meterFill(idea.risk.risk_level)} label={riskLabel(idea.risk.risk_level)} />
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, color: "var(--muted)" }}>
          <Clock size={14} aria-hidden /> Last analysis {dateTimeText(rec.created_at)}
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
 * What saving to Discover said: the reason it failed, or that it worked with the way to the list. The
 * Save button stays where it is (keyboard focus is kept); this is what is announced.
 */
function SaveNotes({ save }: { save: ReturnType<typeof useSaveToDiscover> }) {
  return (
    <>
      {save.problem && <Alert severity="error">{save.problem}</Alert>}
      {save.saved && (
        <Alert severity="success" role="status" action={<Button component={Link} href="/discover" color="inherit" size="small">View in Discover</Button>}>
          Saved to Discover.
        </Alert>
      )}
    </>
  );
}

/**
 * The decision rail: the summary, the portfolio fit and the four actions. Approve and Dismiss only
 * record the decision; Save to Discover adds the company to the Discover list and records nothing.
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
  const save = useSaveToDiscover(idea.ticker, idea.asset_type);
  const [dismissing, setDismissing] = useState(false);
  return (
    <Panel component="aside" aria-label="Decision" sx={{ p: "20px", display: "grid", gap: 2, position: { md: "sticky" }, top: 16 }}>
      <DecisionSummary rec={rec} />
      <Box component="hr" sx={{ border: 0, borderTop: "1px solid var(--line)", m: 0 }} />
      <FitLine idea={idea} />
      <Box component="hr" sx={{ border: 0, borderTop: "1px solid var(--line)", m: 0 }} />
      {error && <Alert severity="error">{error}</Alert>}
      <SaveNotes save={save} />
      {dismissing && <DismissSheet id={rec.id} onClose={() => setDismissing(false)} onDecided={onDecided} />}
      <Box sx={{ display: "grid", gap: 1 }}>
        <Button variant="contained" disabled={submitting} onClick={() => decide("approve")} startIcon={<Check size={16} aria-hidden />}>
          Approve
        </Button>
        <Button variant="outlined" aria-disabled={save.saving || save.saved || undefined} onClick={save.saved ? undefined : () => void save.save()} startIcon={save.saved ? <Check size={16} aria-hidden /> : <Bookmark size={16} aria-hidden />}>
          {save.saved ? "Saved" : "Save to Discover"}
        </Button>
        <Button variant="outlined" disabled={submitting} onClick={() => setDismissing(true)} startIcon={<X size={16} aria-hidden />} sx={{ minHeight: 44 }}>
          Dismiss
        </Button>
        <Button component={Link} href={askHref(rec.id)} variant="outlined" startIcon={<MessageSquare size={16} aria-hidden />}>
          Ask AI
        </Button>
      </Box>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", textAlign: "center" }}>{NOTE}</Typography>
      <SourcesRow idea={idea} onSeeSources={onSeeSources} />
    </Panel>
  );
}

/** On a phone the actions ride above the tab bar: Approve, then Save, Dismiss and Ask as icon buttons. */
export function PhoneActions({ rec, onDecided }: { rec: DiscoveryRecommendation; onDecided: (updated: RecommendationOut) => void }) {
  const idea = rec.idea!;
  const { decide, submitting, error } = useDecision(rec.id, onDecided);
  const save = useSaveToDiscover(idea.ticker, idea.asset_type);
  const [dismissing, setDismissing] = useState(false);
  return (
    <Box sx={{ position: "sticky", bottom: "var(--tabbar-h, 66px)", zIndex: 2, mx: -2, px: 2, py: 1.25, display: "grid", gap: 1, borderTop: "1px solid var(--line)", bgcolor: "var(--panel)" }}>
      {error && <Alert severity="error">{error}</Alert>}
      <SaveNotes save={save} />
      {dismissing && <DismissSheet id={rec.id} onClose={() => setDismissing(false)} onDecided={onDecided} />}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 44px", gap: 1 }}>
        <Button variant="contained" disabled={submitting} onClick={() => decide("approve")} startIcon={<Check size={16} aria-hidden />} sx={{ minHeight: 44 }}>
          Approve
        </Button>
        <Button variant="outlined" aria-disabled={save.saving || save.saved || undefined} onClick={save.saved ? undefined : () => void save.save()} aria-label={save.saved ? "Saved to Discover" : "Save to Discover"} sx={{ minWidth: 0, minHeight: 44, p: 0 }}>
          {save.saved ? <Check size={16} aria-hidden /> : <Bookmark size={16} aria-hidden />}
        </Button>
        <Button variant="outlined" disabled={submitting} onClick={() => setDismissing(true)} aria-label="Dismiss" sx={{ minWidth: 0, minHeight: 44, p: 0 }}>
          <X size={16} aria-hidden />
        </Button>
        <Button component={Link} href={askHref(rec.id)} variant="outlined" aria-label="Ask AI" sx={{ minWidth: 0, minHeight: 44, p: 0 }}>
          <MessageSquare size={16} aria-hidden />
        </Button>
      </Box>
    </Box>
  );
}
