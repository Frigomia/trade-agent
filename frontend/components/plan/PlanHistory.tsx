"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Skeleton,
  Typography,
} from "@mui/material";
import { Trash2 } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { formatAmount } from "@/lib/format";
import { planMonth, planSavedAt, useOpenOrders, usePlans, type Plan, type PlanSummary } from "@/lib/plans";
import { useAction } from "@/lib/useAction";
import { useWhenActive } from "@/lib/useWhenActive";
import { OrdersSection } from "./OrdersSection";

const muted = { fontSize: "0.75rem", color: "var(--muted)" } as const;
const COLUMNS = { xs: "minmax(0, 1fr) auto", md: "minmax(0, 1.2fr) minmax(0, 1.2fr) 130px 70px 110px" };
const rowSx = {
  display: "grid",
  gridTemplateColumns: COLUMNS,
  gap: { xs: "2px 12px", md: 2 },
  alignItems: "center",
  px: { xs: 2, md: 2.5 },
  py: 1.5,
  minHeight: 52,
  borderTop: "1px solid var(--line)",
} as const;
const right = { textAlign: "right" } as const;

/** Saved plans newest first; one opens below the list exactly as saved, and can be deleted after a confirm. */
export function PlanHistory({ active = true }: { active?: boolean }) {
  const { plans, error, isLoading, load, remove } = usePlans();
  // Which saved plans still have lines to place: the same read as the Orders tab's count.
  const { plans: openPlans, isLoading: ordersLoading, isValidating: ordersValidating, error: ordersError } = useOpenOrders();
  const [opened, setOpened] = useState<Plan | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Kept after the dialog closes so its text does not go blank while it fades out.
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const action = useAction();

  // The opened plan again, e.g. after an ISIN was added, so its tickets carry it. A late answer is
  // dropped when another plan was opened (or this one deleted) meanwhile.
  // A .then, not await: the effect below calls it, and the lint reads code after an await as synchronous.
  function reload(): Promise<void> {
    if (opened?.id == null) return Promise.resolve();
    return load(opened.id).then((fresh) => setOpened((current) => (current?.id === fresh.id ? fresh : current)));
  }

  // The page keeps this view mounted while hidden, and a line may have been placed on the Orders view
  // since: back on this view, the opened plan again (a no-op when none is open).
  useWhenActive(active, () => void reload().catch(() => {}));

  if (error) return <Alert severity="error">Could not load your saved plans.</Alert>;
  if (isLoading || !plans) return <Skeleton variant="rounded" height={160} />;
  if (plans.length === 0) {
    return (
      <Panel sx={{ p: "20px", maxWidth: 620 }}>
        <Typography sx={{ color: "var(--text2)" }}>
          No saved plans yet. Make a plan under This month and press Save plan.
        </Typography>
      </Panel>
    );
  }

  const sorted = [...plans].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const openCount = new Map(openPlans.map((p) => [p.id, p.lines.filter((l) => l.placed_at === null).length]));
  const month = opened?.created_at ? planMonth(opened.created_at) : "";

  const open = (summary: PlanSummary) =>
    action.run(async () => {
      setOpened(await load(summary.id));
    });

  async function confirmDelete() {
    setConfirmOpen(false);
    const id = deleting?.id;
    if (id == null) return;
    await action.run(async () => {
      await remove(id);
      setOpened(null);
    });
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Panel role="table" aria-label="Saved plans" sx={{ pt: 0.75, overflow: "hidden" }}>
        <Box role="row" sx={{ ...rowSx, display: { xs: "none", md: "grid" }, borderTop: 0, py: 1, fontSize: "0.75rem", color: "var(--muted)", fontWeight: 500 }}>
          <span role="columnheader">Month</span>
          <span role="columnheader">Saved</span>
          <Box component="span" role="columnheader" sx={right}>
            Amount
          </Box>
          <Box component="span" role="columnheader" sx={right}>
            Lines
          </Box>
          <Box component="span" role="columnheader" sx={right}>
            Orders
          </Box>
        </Box>
        {sorted.map((p) => {
          const m = planMonth(p.created_at);
          return (
            <Box
              role="row"
              key={p.id}
              sx={{ ...rowSx, position: "relative", bgcolor: opened?.id === p.id ? "var(--accent-wash)" : undefined, "&:hover": { bgcolor: opened?.id === p.id ? undefined : "var(--track)" } }}
            >
              <Box role="cell" sx={{ fontWeight: 650, fontSize: "0.8125rem", color: opened?.id === p.id ? "var(--accent)" : undefined }}>
                {/* The whole row opens the plan: this button is stretched over it. */}
                <Box
                  component="button"
                  type="button"
                  onClick={() => void open(p)}
                  disabled={action.submitting}
                  aria-label={`Open the ${m} plan`}
                  sx={{ position: "absolute", inset: 0, width: "100%", border: 0, bgcolor: "transparent", cursor: "pointer", "&:focus-visible": { outline: "2px solid var(--accent-solid)", outlineOffset: -2 } }}
                />
                {m}
              </Box>
              <Box role="cell" sx={{ ...muted, gridColumn: { xs: "1 / -1", md: "auto" } }}>
                {planSavedAt(p.created_at)} <Box component="span" sx={{ display: { md: "none" } }}>· {p.line_count} lines</Box>
              </Box>
              <Box role="cell" sx={{ ...right, gridRow: { xs: 1, md: "auto" }, gridColumn: { xs: 2, md: "auto" }, whiteSpace: "nowrap" }}>
                {formatAmount(p.amount_eur)} EUR
              </Box>
              <Box role="cell" sx={{ ...right, display: { xs: "none", md: "block" } }}>
                {p.line_count}
              </Box>
              <Box role="cell" sx={{ ...right, gridColumn: { xs: "1 / -1", md: "auto" }, textAlign: { xs: "left", md: "right" } }}>
                {/* Only said when the read is settled: a plan just saved is not in it yet, and is not "placed". */}
                {!ordersLoading && !ordersValidating && !ordersError && p.line_count > 0 && ((openCount.get(p.id) ?? 0) > 0 ? <Pill tone="accent">{openCount.get(p.id)} open</Pill> : <Pill>All placed</Pill>)}
              </Box>
            </Box>
          );
        })}
      </Panel>

      {action.error && <Alert severity="error">{action.error}</Alert>}

      {opened?.created_at && (
        <>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 1.5, flexWrap: "wrap" }}>
            <Box>
              <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650 }}>
                {month}, as saved
              </Typography>
              <Typography sx={muted}>Saved {planSavedAt(opened.created_at)}. Prices and rates of that day.</Typography>
            </Box>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Trash2 size={14} />}
              disabled={action.submitting}
              onClick={() => {
                setDeleting(opened);
                setConfirmOpen(true);
              }}
            >
              Delete plan
            </Button>
          </Box>
          <OrdersSection key={opened.id} plan={opened} onChanged={reload} onPlaced={() => void reload().catch(() => {})} />
        </>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} aria-labelledby="plan-delete-title">
        <DialogTitle id="plan-delete-title">Delete the {deleting?.created_at ? planMonth(deleting.created_at) : ""} plan?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            It is removed from your saved plans ({formatAmount(deleting?.amount_eur ?? 0)} EUR, {deleting?.lines.length ?? 0}{" "}
            lines). This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()}>
            Delete plan
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
