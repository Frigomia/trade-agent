"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Box, Button, Link as MuiLink, Skeleton, Typography } from "@mui/material";
import { ArrowRight, Check, Clock } from "lucide-react";
import { formatAmount } from "@/lib/format";
import { isOldPlan, planDay, planMonth, planSavedAt, useOpenOrders, type Plan } from "@/lib/plans";
import { OrdersSection } from "./OrdersSection";

const muted = { fontSize: 12.5, color: "var(--muted)" } as const;
// Kept mounted while empty, so a new message is announced.
const visuallyHidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

function PlanHeading({ plan, id }: { plan: Plan; id: string }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Typography id={id} component="h2" sx={{ fontSize: 17, fontWeight: 650 }}>
        {planMonth(plan.created_at!)}
        <Box component="span" sx={{ fontWeight: 500, color: "var(--text2)" }}>
          , {plan.lines.length} open
        </Box>
      </Typography>
      <Typography sx={{ ...muted, fontVariantNumeric: "tabular-nums" }}>
        Saved {planSavedAt(plan.created_at!)} · {formatAmount(plan.amount_eur)} EUR plan
      </Typography>
    </Box>
  );
}

function OldNote({ iso }: { iso: string }) {
  return (
    <Box sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", px: 1.75, py: 1.25, borderRadius: "12px", bgcolor: "var(--warn-bg)", fontSize: 14, lineHeight: 1.5, maxWidth: 760 }}>
      <Box component="span" aria-hidden sx={{ display: "flex", color: "var(--warn)", pt: "2px" }}>
        <Clock size={16} />
      </Box>
      <span>Planned {planDay(iso)}. Prices and weights have moved since; make a new plan if this is no longer what you want.</span>
    </Box>
  );
}

function Empty() {
  return (
    <Box sx={{ maxWidth: 560, pt: 2.5, display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Typography component="h2" sx={{ fontSize: 19, fontWeight: 650 }}>
        No open orders.
      </Typography>
      <Typography sx={{ fontSize: 14, lineHeight: 1.55, color: "var(--text2)" }}>
        Orders come from saving a plan. Make this month&apos;s plan and press Save plan; each of its lines then waits here until you
        mark it placed.
      </Typography>
      <MuiLink
        component={Link}
        href="/portfolio/plan"
        sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: 44, fontSize: 14, fontWeight: 500, alignSelf: "flex-start" }}
      >
        Go to This month
        <ArrowRight size={16} aria-hidden />
      </MuiLink>
    </Box>
  );
}

/**
 * The Orders tab (direction A): every saved plan with open lines, newest first, one section each with
 * a sticky heading and that plan's open lines through OrdersSection (Copy, Placed, the sheet and the
 * auto-advance unchanged). A placed line leaves on the refetch; a plan with none left disappears.
 */
export function OrdersView() {
  const { plans, error, isLoading, mutate } = useOpenOrders();
  // Read once per visit: whether a plan is old does not need to tick while the tab is open.
  const [now] = useState(() => Date.now());
  // The section of a plan whose last line was placed is gone, so it says so here.
  const [status, setStatus] = useState("");

  if (error && plans.length === 0) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => void mutate()}>
            Retry
          </Button>
        }
      >
        Could not load your open orders.
      </Alert>
    );
  }
  if (isLoading) {
    return (
      <Box data-testid="orders-loading" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Skeleton variant="rounded" height={48} />
        <Skeleton variant="rounded" height={160} />
      </Box>
    );
  }

  return (
    <Box>
      <Box
        role="status"
        aria-live="polite"
        sx={status ? { display: "flex", alignItems: "flex-start", gap: 1, mb: 1.5, fontSize: 14, color: "var(--text2)" } : visuallyHidden}
      >
        {status && (
          <Box component="span" aria-hidden sx={{ display: "flex", color: "var(--up)", pt: "2px" }}>
            <Check size={16} />
          </Box>
        )}
        {status}
      </Box>
      {plans.length === 0 ? (
        <Empty />
      ) : (
        <>
          {plans.map((plan) => {
            const headingId = `orders-plan-${plan.id}`;
            return (
              <Box component="section" key={plan.id} aria-labelledby={headingId} sx={{ mb: 3 }}>
                <OrdersSection
                  plan={plan}
                  onChanged={() => mutate()}
                  heading={<PlanHeading plan={plan} id={headingId} />}
                  notice={isOldPlan(plan.created_at!, now) ? <OldNote iso={plan.created_at!} /> : undefined}
                  onPlaced={(line, next) =>
                    setStatus(next ? "" : `${line.ticker} recorded as placed. It was the last open order of ${planMonth(plan.created_at!)}.`)
                  }
                />
              </Box>
            );
          })}
          <Typography sx={muted}>Tap a line to open its order. After Placed, the next open line of that plan opens by itself.</Typography>
        </>
      )}
    </Box>
  );
}
