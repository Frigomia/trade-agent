"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Alert, Box, Button, Typography } from "@mui/material";
import { Building2, Check, MessageSquare, Sparkles, X } from "lucide-react";
import { LogTradeCta } from "@/components/portfolio/LogTradeCta";
import { DismissSheet } from "@/components/recommendations/DismissSheet";
import { Panel } from "@/components/ui/Panel";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { useDecision } from "@/lib/useDecision";
import { askHref, DecisionSummary, FitLine } from "./DecisionRail";

export { SinceRecommended } from "./DecisionRail";

const RULE = <Box component="hr" sx={{ border: 0, borderTop: "1px solid var(--line)", m: 0 }} />;
const NOTE_SX = { fontSize: "0.75rem", color: "var(--muted)", textAlign: "center" } as const;
// LogTradeCta carries its own top margin for the confirmation card; in a stack of actions the gap spaces it.
const ACTIONS_SX = { display: "grid", gap: 1, "& > .MuiButton-root, & > .MuiAlert-root": { mt: 0 } } as const;
const companyHref = (ticker: string) => `/discover/company/${encodeURIComponent(ticker)}`;
const NOT_YET = "Re-running a researched company is not available yet.";

/**
 * Reverse a decision, as the confirmation does: an approval is changed through the dismiss sheet
 * (so a reason can be kept), a dismissal by approving. Only the decision is recorded.
 */
function useChangeDecision(rec: DiscoveryRecommendation, onChanged: (updated: RecommendationOut) => void) {
  const { decide, submitting, error } = useDecision(rec.id, onChanged);
  const [dismissing, setDismissing] = useState(false);
  const approved = rec.status === "APPROVED";
  const change = () => (approved ? setDismissing(true) : void decide("approve"));
  const sheet = dismissing && <DismissSheet id={rec.id} onClose={() => setDismissing(false)} onDecided={onChanged} />;
  return { approved, change, submitting, error, sheet };
}

/** The rail of an approved or dismissed idea: where the price is now, then only the actions that still make sense. */
export function DecidedRail({ rec, onChanged }: { rec: DiscoveryRecommendation; onChanged: (updated: RecommendationOut) => void }) {
  const { approved, change, submitting, error, sheet } = useChangeDecision(rec, onChanged);
  return (
    <Panel component="aside" aria-label="Your decision" sx={{ p: "20px", display: "grid", gap: 2, position: { md: "sticky" }, top: 16 }}>
      <DecisionSummary rec={rec} showSince />
      {RULE}
      <FitLine idea={rec.idea!} />
      {RULE}
      {error && <Alert severity="error">{error}</Alert>}
      {sheet}
      <Box sx={ACTIONS_SX}>
        {approved && <LogTradeCta recommendation={rec} />}
        <Button variant="outlined" disabled={submitting} onClick={change} startIcon={approved ? <X size={16} aria-hidden /> : <Check size={16} aria-hidden />}>
          Change my decision
        </Button>
        <Button component={Link} href={askHref(rec.id)} variant="outlined" startIcon={<MessageSquare size={16} aria-hidden />}>
          Ask AI
        </Button>
      </Box>
      <Typography sx={NOTE_SX}>{approved ? "Recorded only. No order was placed." : "Recorded only. Nothing was sent to a broker."}</Typography>
    </Panel>
  );
}

/** Visible so the way back is clear, but it does nothing yet: the analyze endpoint returns the saved result. */
export function RunAgainDisabled() {
  const hintId = useId();
  return (
    <Box sx={{ display: "grid", gap: 0.75 }}>
      <Button
        variant="outlined"
        aria-disabled
        aria-describedby={hintId}
        startIcon={<Sparkles size={16} aria-hidden />}
        sx={{ minHeight: 44, color: "var(--muted)", borderColor: "var(--line)", cursor: "default", "&:hover": { borderColor: "var(--line)", bgcolor: "transparent" } }}
      >
        Run a new analysis
      </Button>
      <Typography id={hintId} sx={NOTE_SX}>
        {NOT_YET}
      </Typography>
    </Box>
  );
}

/** The rail of a withdrawn idea: no decision to make, so the company overview leads. */
export function WithdrawnRail({ rec }: { rec: DiscoveryRecommendation }) {
  return (
    <Panel component="aside" aria-label="Withdrawn idea" sx={{ p: "20px", display: "grid", gap: 2, position: { md: "sticky" }, top: 16 }}>
      <DecisionSummary rec={rec} showSince />
      {RULE}
      <Box sx={ACTIONS_SX}>
        <Button component={Link} href={companyHref(rec.ticker)} variant="contained" startIcon={<Building2 size={16} aria-hidden />}>
          Company overview
        </Button>
        <RunAgainDisabled />
        <Button component={Link} href={askHref(rec.id)} variant="outlined" startIcon={<MessageSquare size={16} aria-hidden />}>
          Ask AI
        </Button>
      </Box>
    </Panel>
  );
}

const BAR_SX = { position: "sticky", bottom: "var(--tabbar-h, 66px)", zIndex: 2, mx: -2, px: 2, py: 1.25, display: "grid", gap: 1, borderTop: "1px solid var(--line)", bgcolor: "var(--panel)" } as const;
const ROW_SX = { display: "grid", gridTemplateColumns: "1fr 44px", gap: 1 } as const;

function AskIcon({ rec }: { rec: DiscoveryRecommendation }) {
  return (
    <Button component={Link} href={askHref(rec.id)} variant="outlined" aria-label="Ask AI" sx={{ minWidth: 0, minHeight: 44, p: 0 }}>
      <MessageSquare size={16} aria-hidden />
    </Button>
  );
}

/** On a phone: Log the trade I placed (approved) over Change my decision and Ask AI. */
export function DecidedPhoneBar({ rec, onChanged }: { rec: DiscoveryRecommendation; onChanged: (updated: RecommendationOut) => void }) {
  const { approved, change, submitting, error, sheet } = useChangeDecision(rec, onChanged);
  return (
    <Box sx={{ ...BAR_SX, ...ACTIONS_SX }}>
      {error && <Alert severity="error">{error}</Alert>}
      {sheet}
      {approved && <LogTradeCta recommendation={rec} />}
      <Box sx={ROW_SX}>
        <Button variant="outlined" disabled={submitting} onClick={change} sx={{ minHeight: 44 }}>
          Change my decision
        </Button>
        <AskIcon rec={rec} />
      </Box>
    </Box>
  );
}

/** On a phone: Company overview and Ask AI (the disabled re-run sits in the summary above the tabs). */
export function WithdrawnPhoneBar({ rec }: { rec: DiscoveryRecommendation }) {
  return (
    <Box sx={{ ...BAR_SX, ...ROW_SX }}>
      <Button component={Link} href={companyHref(rec.ticker)} variant="contained" startIcon={<Building2 size={16} aria-hidden />} sx={{ minHeight: 44 }}>
        Company overview
      </Button>
      <AskIcon rec={rec} />
    </Box>
  );
}
