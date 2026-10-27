"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Box, Button, Skeleton, Typography } from "@mui/material";
import { ArrowRight, Check, Clock } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { formatAmount } from "@/lib/format";
import { isOldPlan, planDay, planMonth, useOpenOrders, usePlans, type Plan } from "@/lib/plans";
import { PlacedProgress } from "./PlacedProgress";
import { OrdersSection } from "./OrdersSection";

const muted = { fontSize: "0.75rem", color: "var(--muted)" } as const;
// Kept mounted while empty, so a new message is announced.
const visuallyHidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

/** `total` is the plan's whole line count: the open-orders read has only the unplaced lines, so it comes from the saved plans. */
function PlanHeading({ plan, created, id, total }: { plan: Plan; created: string; id: string; total: number | null }) {
  const placed = total === null ? 0 : Math.max(total - plan.lines.length, 0);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Typography id={id} component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650 }}>
        {planMonth(created)}
        <Box component="span" sx={{ fontWeight: 500, color: "var(--text2)" }}>
          , {plan.lines.length} open
        </Box>
      </Typography>
      <Typography sx={{ ...muted, fontVariantNumeric: "tabular-nums" }}>
        Saved {planDay(created)} · {formatAmount(plan.amount_eur)} EUR plan
      </Typography>
      {total !== null && (
        <Box role="img" aria-label={`${placed} of ${total} placed`} sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.75, minWidth: 0 }}>
          <PlacedProgress placed={Array.from({ length: total }, (_, i) => i < placed)} />
          <Box component="span" aria-hidden sx={{ ...muted, flex: "none", whiteSpace: "nowrap" }}>
            {placed} of {total} placed
          </Box>
        </Box>
      )}
    </Box>
  );
}

function OldNote({ iso }: { iso: string }) {
  return (
    <Box sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", px: 1.75, py: 1.25, borderRadius: "12px", bgcolor: "var(--warn-bg)", fontSize: "0.8125rem", lineHeight: 1.5, maxWidth: 760 }}>
      <Box component="span" aria-hidden sx={{ display: "flex", color: "var(--warn)", pt: "2px" }}>
        <Clock size={16} />
      </Box>
      <span>Planned {planDay(iso)}. Prices and weights have moved since; make a new plan if this is no longer what you want.</span>
    </Box>
  );
}

function Empty() {
  return (
    <Panel sx={{ maxWidth: 640, p: { xs: "20px 16px", md: "22px 24px" }, display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography component="h2" sx={{ fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.02em" }}>
        No open orders.
      </Typography>
      <Typography sx={{ fontSize: "0.8125rem", lineHeight: 1.55, color: "var(--text2)" }}>
        Orders come from saving a plan. Make this month&apos;s plan and press Save plan; each of its lines then waits here until you
        mark it placed.
      </Typography>
      <Button component={Link} href="/portfolio/plan" variant="contained" endIcon={<ArrowRight size={16} aria-hidden />} sx={{ alignSelf: "flex-start" }}>
        Go to This month
      </Button>
    </Panel>
  );
}

/**
 * The Orders tab: every saved plan with open lines, newest first, one panel each with
 * its heading, a progress count and that plan's open lines through OrdersSection (Copy, Placed, the sheet and the
 * auto-advance unchanged). A placed line leaves on the refetch; a plan with none left disappears.
 */
export function OrdersView() {
  const { plans, error, isLoading, mutate } = useOpenOrders();
  // Each plan's whole line count, to show how many are placed (null while it loads or when it fails).
  const { plans: summaries } = usePlans();
  // Read once per visit: whether a plan is old does not need to tick while the tab is open.
  const [now] = useState(() => Date.now());
  // The section of a plan whose last line was placed is gone, so it says so here.
  const [status, setStatus] = useState("");
  // ...and takes the focus, which would otherwise fall to the page with the section. This parent effect
  // runs after the recorded card's own focus effect, so it wins.
  const statusBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status) statusBox.current?.focus();
  }, [status]);

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
        ref={statusBox}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        sx={status ? { display: "flex", alignItems: "flex-start", gap: 1, mb: 1.5, fontSize: "0.8125rem", color: "var(--text2)", outline: "none" } : visuallyHidden}
      >
        {status && (
          <Box component="span" aria-hidden sx={{ display: "flex", color: "var(--accent)", pt: "2px" }}>
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
            const created = plan.created_at!;
            const headingId = `orders-plan-${plan.id}`;
            return (
              <Box component="section" key={plan.id} aria-labelledby={headingId} sx={{ mb: 3 }}>
                <OrdersSection
                  plan={plan}
                  onChanged={() => mutate()}
                  heading={<PlanHeading plan={plan} created={created} id={headingId} total={summaries?.find((s) => s.id === plan.id)?.line_count ?? null} />}
                  notice={isOldPlan(created, now) ? <OldNote iso={created} /> : undefined}
                  onPlaced={(line, next) =>
                    setStatus(next ? "" : `${line.ticker} recorded as placed. It was the last open order of ${planMonth(created)}.`)
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
