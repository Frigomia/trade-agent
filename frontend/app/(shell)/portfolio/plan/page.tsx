"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { Alert, Box, Button, Skeleton, Typography } from "@mui/material";
import { ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import { formatAmount } from "@/lib/format";
import { AMOUNT_ERROR, DISCLAIMER, parseAmount, planSavedAt, plansDiffer, previewPlan, usePlans, type Plan } from "@/lib/plans";
import type { Preferences } from "@/lib/preferences";
import { useAction } from "@/lib/useAction";
import { PlanForm } from "@/components/plan/PlanForm";
import { PlanResult } from "@/components/plan/PlanResult";
import { PlanHistory } from "@/components/plan/PlanHistory";
import { PageHeader } from "@/components/shell/PageHeader";
import { PortfolioTabs } from "@/components/portfolio/PortfolioTabs";
import { Panel } from "@/components/ui/Panel";

const STEPS = [
  "Open Portfolio and edit a holding, or add a ticker to the watchlist.",
  "Fill in Target weight, for example 20% for a fund you want to be a fifth of the portfolio.",
  "Come back here and press Make plan.",
];

const stepBadge = {
  display: "flex",
  gap: 1.5,
  alignItems: "flex-start",
  fontSize: 14,
  "&::before": {
    counterIncrement: "step",
    content: "counter(step)",
    flex: "none",
    width: 24,
    height: 24,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: 650,
    bgcolor: "var(--up-bg)",
    color: "var(--accent)",
  },
} as const;

function hasTargets(summary: PortfolioSummary): boolean {
  return (
    summary.holdings.some((h) => (h.target_weight ?? 0) > 0) ||
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
      <Box
        component="ol"
        sx={{ m: 0, p: 0, listStyle: "none", counterReset: "step", display: "flex", flexDirection: "column", gap: 1, color: "var(--text2)" }}
      >
        {STEPS.map((step) => (
          <Box component="li" key={step} sx={stepBadge}>
            {step}
          </Box>
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
  const [refreshed, setRefreshed] = useState(false);
  const make = useAction();
  const saving = useAction();

  // Once a plan is on screen the switch shows that plan's mode; a flip only sticks when the new plan arrives.
  function request(whole: boolean) {
    const value = parseAmount(amount);
    if (value === null) {
      make.setError(AMOUNT_ERROR);
      return;
    }
    void make.run(async () => {
      const next = await previewPlan({ amount: value, whole_shares: whole });
      setPlan(next);
      setRefreshed(false);
      setWholeShares(next.whole_shares);
    });
  }

  function toggleWhole(next: boolean) {
    if (plan) request(next);
    else setWholeShares(next);
  }

  // The field changed since this plan was made: saving would store a plan for another amount.
  const stale = plan !== null && plan.id === null && parseAmount(amount) !== plan.amount_eur;

  const footer =
    plan?.created_at ? (
      <Typography sx={{ fontSize: 12.5, color: "var(--muted)" }} role="status">
        Saved {planSavedAt(plan.created_at)}. You find it under Saved plans.
      </Typography>
    ) : plan ? (
      <Button
        variant="contained"
        disabled={stale || saving.submitting || make.submitting}
        onClick={() =>
          void saving.run(async () => {
            const stored = await save({ amount: plan.amount_eur, whole_shares: plan.whole_shares });
            setRefreshed(plansDiffer(plan, stored));
            setPlan(stored);
          })
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
        pending={make.submitting || saving.submitting}
      />
      {make.error && <Alert severity="error">{make.error}</Alert>}
      {saving.error && <Alert severity="error">{saving.error}</Alert>}
      {stale && (
        <Typography role="status" sx={{ fontSize: 13, color: "var(--warn)" }}>
          This plan is for {formatAmount(plan.amount_eur)} EUR. Press Make plan to update.
        </Typography>
      )}
      {refreshed && plan?.created_at && (
        <Alert severity="info">Prices were refreshed when saving; this is the plan that was saved.</Alert>
      )}
      {plan && <PlanResult plan={plan} footer={plan.lines.length > 0 ? footer : null} />}
    </Box>
  );
}

export default function PlanPage() {
  const { data: prefs, error: prefsError } = useSWR<Preferences>("/preferences", apiFetch);
  const { data: summary, error: summaryError, mutate: retrySummary } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  // This month and Saved plans are one route; only ?tab changes, which Next does not remount.
  const saved = useSearchParams().get("tab") === "saved";

  // Preferences only prefill the amount: if they fail, the field starts empty.
  const ready = summary !== undefined && (prefs !== undefined || prefsError);

  return (
    <Box>
      <PageHeader title="Portfolio" />
      <PortfolioTabs current={saved ? "saved" : "month"} />

      {/* Both panels stay mounted, so a preview survives a look at the saved plans. */}
      <Box hidden={saved}>
        {/* A failed background revalidation keeps the data on screen; only a first load failure shows. */}
        {summaryError && !summary && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void retrySummary()}>
                Retry
              </Button>
            }
          >
            Could not load your portfolio.
          </Alert>
        )}
        {!summaryError && !ready && <Skeleton variant="rounded" height={72} />}
        {ready && !hasTargets(summary) && <NoTargets />}
        {ready && hasTargets(summary) && <ThisMonth initialAmount={prefs?.monthly_contribution ?? null} />}
      </Box>
      <Box hidden={!saved}>
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
