"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import useSWR, { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary } from "@/lib/api/portfolio-types";
import { nextUnplaced } from "@/lib/orders";
import type { Plan, PlanLine } from "@/lib/plans";
import { OrdersPanel } from "./OrdersPanel";
import { PlacedSheet } from "./PlacedSheet";

export interface OrdersSectionProps {
  /** A saved plan (`id !== null`). */
  plan: Plan;
  /** Reloads the plan; the parent replaces `plan` with the fresh one. */
  onChanged: () => Promise<unknown>;
  footer?: ReactNode;
}

/**
 * A saved plan's orders with the Record placed order flow, shared by This month and Saved plans: it
 * owns which line is open, the sheet, and the status line. After a line is recorded the next unplaced
 * line opens by itself and takes the focus.
 */
export function OrdersSection({ plan, onChanged, footer }: OrdersSectionProps) {
  // The plan page loads it already; SWR shares the one request.
  const { data: summary } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { mutate } = useSWRConfig();
  const [openTicker, setOpenTicker] = useState<string | null>(null);
  const [sheetLine, setSheetLine] = useState<PlanLine | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [focusTo, setFocusTo] = useState<{ ticker: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // A late answer must not act on a view that moved on. Both parents key this component by plan id,
  // so another plan means a fresh instance and this one unmounted; the sheet's line is checked too.
  const mounted = useRef(true);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // After a recorded line, focus the card that opened (or the recorded one when none is left). The
  // sheet's own focus return lands on the Placed button, which is gone by then.
  useEffect(() => {
    if (!focusTo || !root.current) return;
    const card = [...root.current.querySelectorAll<HTMLElement>("li[data-ticker]")].find((li) => li.dataset.ticker === focusTo.ticker);
    card?.querySelector<HTMLElement>("button")?.focus();
  }, [focusTo]);

  function place(line: PlanLine) {
    asked.current = line.ticker;
    setSheetLine(line);
    setSheetOpen(true);
  }

  function placed(line: PlanLine) {
    // The new trade moved holdings and totals: refresh every portfolio read, even when this view has
    // gone (the cache is global, so the next screen shows the new numbers).
    const portfolio = mutate((key) => typeof key === "string" && key.startsWith("/portfolio"));
    if (!mounted.current) return;
    if (asked.current !== line.ticker) {
      void Promise.allSettled([onChanged(), portfolio]); // another line is open now: no auto-advance
      return;
    }
    const next = nextUnplaced(plan, line.ticker);
    setSheetOpen(false);
    setOpenTicker(next?.ticker ?? null);
    setStatus(
      next
        ? `${line.ticker} recorded as placed. Next: ${next.ticker}, opened for you.`
        : `${line.ticker} recorded as placed. All lines placed.`,
    );
    setFocusTo({ ticker: next?.ticker ?? line.ticker });
    void Promise.allSettled([onChanged(), portfolio]); // the plan, for the placed chip
  }

  return (
    <Box ref={root}>
      <OrdersPanel
        plan={plan}
        onChanged={onChanged}
        onPlace={place}
        openTicker={openTicker}
        onOpenTickerChange={setOpenTicker}
        status={status}
        footer={footer}
      />
      <PlacedSheet
        open={sheetOpen}
        line={sheetLine}
        planId={plan.id}
        summary={summary}
        onClose={() => setSheetOpen(false)}
        onPlaced={placed}
        onChanged={() => (mounted.current ? onChanged() : Promise.resolve())}
      />
    </Box>
  );
}
