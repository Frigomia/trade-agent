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
import { formatAmount } from "@/lib/format";
import { planMonth, planSavedAt, usePlans, type Plan, type PlanSummary } from "@/lib/plans";
import { useAction } from "@/lib/useAction";
import { OrdersSection } from "./OrdersSection";

const muted = { fontSize: 12.5, color: "var(--muted)" } as const;
const COLUMNS = { xs: "minmax(0, 1fr) auto", md: "180px minmax(0, 1fr) 140px 80px 120px" };
const rowSx = {
  display: "grid",
  gridTemplateColumns: COLUMNS,
  gap: { xs: "2px 12px", md: 2 },
  alignItems: "center",
  px: { xs: 2, md: 2.5 },
  py: 1.5,
  borderTop: "1px solid var(--line)",
} as const;
const right = { textAlign: "right" } as const;

/** Saved plans newest first; one opens below the list exactly as saved, and can be deleted after a confirm. */
export function PlanHistory() {
  const { plans, error, isLoading, load, remove } = usePlans();
  const [opened, setOpened] = useState<Plan | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Kept after the dialog closes so its text does not go blank while it fades out.
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const action = useAction();

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
  const month = opened?.created_at ? planMonth(opened.created_at) : "";

  const open = (summary: PlanSummary) =>
    action.run(async () => {
      setOpened(await load(summary.id));
    });

  // The opened plan again, e.g. after an ISIN was added, so its tickets carry it.
  async function reload() {
    if (opened?.id != null) setOpened(await load(opened.id));
  }

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
        <Box role="row" sx={{ ...rowSx, display: { xs: "none", md: "grid" }, borderTop: 0, py: 1, fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
          <span role="columnheader">Month</span>
          <span role="columnheader">Saved</span>
          <Box component="span" role="columnheader" sx={right}>
            Amount
          </Box>
          <Box component="span" role="columnheader" sx={right}>
            Lines
          </Box>
          <Box component="span" role="columnheader" sx={right}>
            <Box component="span" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
              Open
            </Box>
          </Box>
        </Box>
        {sorted.map((p) => {
          const m = planMonth(p.created_at);
          return (
            <Box role="row" key={p.id} sx={{ ...rowSx, bgcolor: opened?.id === p.id ? "var(--up-bg)" : undefined }}>
              <Box role="cell" sx={{ fontWeight: 650 }}>
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
                <Button size="small" onClick={() => void open(p)} disabled={action.submitting} aria-label={`Open the ${m} plan`}>
                  Open
                </Button>
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
              <Typography component="h2" sx={{ fontSize: 16, fontWeight: 650 }}>
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
          <OrdersSection key={opened.id} plan={opened} onChanged={reload} />
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
