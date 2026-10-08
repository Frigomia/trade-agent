"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Alert, Box, Button, Link as MuiLink, Skeleton, Tab, Tabs, Typography } from "@mui/material";
import { ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import { DISCLAIMER, parseAmount, planSavedAt, previewPlan, usePlans, type Plan } from "@/lib/plans";
import type { Preferences } from "@/lib/preferences";
import { useAction } from "@/lib/useAction";
import { PlanForm } from "@/components/plan/PlanForm";
import { PlanResult } from "@/components/plan/PlanResult";
import { PlanHistory } from "@/components/plan/PlanHistory";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel } from "@/components/ui/Panel";

const STEPS = [
  "Open Portfolio and edit a holding, or add a ticker to the watchlist.",
  "Fill in Target weight, for example 20% for a fund you want to be a fifth of the portfolio.",
  "Come back here and press Make plan.",
];

function hasTargets(summary: PortfolioSummary): boolean {
  return (
    summary.holdings.some((h) => h.shares > 0 && (h.target_weight ?? 0) > 0) ||
    summary.watchlist.some((w) => (w.target_weight ?? 0) > 0)
  );
}

function NoTargets() {
  return (
    <Panel sx={{ p: { xs: "20px 16px", md: "28px" }, display: "flex", flexDirection: "column", gap: 1.5, maxWidth: 620 }}>
      <Typography component="h2" sx={{ fontSize: 18, fontWeight: 650 }}>
        Set a target weight first
      </Typography>
      <Typography sx={{ color: "var(--text2)" }}>
        The plan shares your money out by the weight you want each holding or watchlist ticker to have. Nothing has a
        target yet.
      </Typography>
      <Box component="ol" sx={{ m: 0, pl: 3, display: "flex", flexDirection: "column", gap: 1, color: "var(--text2)" }}>
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </Box>
      <Box>
        <Button component={Link} href="/portfolio" variant="contained" size="small">
          Go to Portfolio
        </Button>
      </Box>
    </Panel>
  );
}

/** "This month": the form and the preview, which lives only in this component's state until saved. */
function ThisMonth({ initialAmount }: { initialAmount: number | null }) {
  const { save } = usePlans();
  const [amount, setAmount] = useState(initialAmount !== null ? initialAmount.toFixed(2) : "");
  const [wholeShares, setWholeShares] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const make = useAction();
  const saving = useAction();

  function request(whole: boolean) {
    const value = parseAmount(amount);
    if (value === null) return;
    void make.run(async () => setPlan(await previewPlan({ amount: value, whole_shares: whole })));
  }

  function toggleWhole(next: boolean) {
    setWholeShares(next);
    if (plan) request(next); // a plan on screen follows the switch
  }

  const footer =
    plan?.created_at ? (
      <Typography sx={{ fontSize: 12.5, color: "var(--muted)" }} role="status">
        Saved {planSavedAt(plan.created_at)}. You find it under Saved plans.
      </Typography>
    ) : plan ? (
      <Button
        variant="contained"
        disabled={saving.submitting || make.submitting}
        onClick={() =>
          void saving.run(async () =>
            setPlan(await save({ amount: plan.amount_eur, whole_shares: plan.whole_shares })),
          )
        }
      >
        Save plan
      </Button>
    ) : null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.75 }}>
      <PlanForm
        amount={amount}
        onAmountChange={setAmount}
        wholeShares={wholeShares}
        onWholeSharesChange={toggleWhole}
        onSubmit={() => request(wholeShares)}
        pending={make.submitting}
      />
      {make.error && <Alert severity="error">{make.error}</Alert>}
      {saving.error && <Alert severity="error">{saving.error}</Alert>}
      {plan && <PlanResult plan={plan} footer={plan.lines.length > 0 ? footer : null} />}
    </Box>
  );
}

export default function PlanPage() {
  const { data: prefs, error: prefsError } = useSWR<Preferences>("/preferences", apiFetch);
  const { data: summary, error: summaryError } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const [tab, setTab] = useState(0);

  // Preferences only prefill the amount: if they fail, the field starts empty.
  const ready = summary !== undefined && (prefs !== undefined || prefsError);

  return (
    <Box>
      <PageHeader
        title="Plan"
        subtitle={
          <>
            <MuiLink component={Link} href="/portfolio">
              Portfolio
            </MuiLink>{" "}
            / Plan
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(_, next: number) => setTab(next)}
        sx={{ mb: 1.75, maxWidth: 360 }}
        variant="fullWidth"
      >
        <Tab label="This month" id="plan-tab-0" aria-controls="plan-panel-0" />
        <Tab label="Saved plans" id="plan-tab-1" aria-controls="plan-panel-1" />
      </Tabs>

      {/* Both panels stay mounted, so a preview survives a look at the saved plans. */}
      <Box role="tabpanel" id="plan-panel-0" aria-labelledby="plan-tab-0" hidden={tab !== 0}>
        {summaryError && <Alert severity="error">Could not load your portfolio.</Alert>}
        {!summaryError && !ready && <Skeleton variant="rounded" height={72} />}
        {ready && !hasTargets(summary) && <NoTargets />}
        {ready && hasTargets(summary) && <ThisMonth initialAmount={prefs?.monthly_contribution ?? null} />}
      </Box>
      <Box role="tabpanel" id="plan-panel-1" aria-labelledby="plan-tab-1" hidden={tab !== 1}>
        <PlanHistory />
      </Box>

      <Typography
        sx={{ mt: 2, fontSize: 12.5, color: "var(--muted)", display: "flex", gap: 1, alignItems: "center" }}
      >
        <Box component="span" sx={{ color: "var(--accent)", display: "flex" }}>
          <ShieldCheck size={15} aria-hidden />
        </Box>
        {DISCLAIMER}
      </Typography>
    </Box>
  );
}
