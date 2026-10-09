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
  /**
   * The plan comes from the open orders read, which a placement refreshes already: onChanged is not
   * called again after one (it still is after an ISIN change and a 409 "already recorded").
   */
  fromOpenOrders?: boolean;
  footer?: ReactNode;
  /** The Orders tab's sticky plan heading and old-plan note; see OrdersPanel. */
  heading?: ReactNode;
  notice?: ReactNode;
  /** After a line is recorded, with the line that opens next (null: none left in this plan). */
  onPlaced?: (line: PlanLine, next: PlanLine | null) => void;
}

/**
 * A saved plan's orders with the Record placed order flow, shared by This month and Saved plans: it
 * owns which line is open, the sheet, and the status line. After a line is recorded the next unplaced
 * line opens by itself and takes the focus.
 */
export function OrdersSection({ plan, onChanged, fromOpenOrders, footer, heading, notice, onPlaced }: OrdersSectionProps) {
  // The plan page loads it already; SWR shares the one request.
  const { data: summary } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { mutate } = useSWRConfig();
  const [openTicker, setOpenTicker] = useState<string | null>(null);
  const [sheetLine, setSheetLine] = useState<PlanLine | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [focusTicker, setFocusTicker] = useState<string | null>(null);
  // A late answer must not act on a view that moved on. Both parents key this component by plan id,
  // so another plan means a fresh instance and this one unmounted; the sheet's line is checked too.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function place(line: PlanLine) {
    setSheetLine(line);
    setSheetOpen(true);
  }

  function placed(line: PlanLine) {
    // The new trade moved holdings and totals and left one open order fewer: refresh every portfolio
    // read and the open orders (the strip's badge), even when this view has gone (the cache is global,
    // so the next screen shows the new numbers).
    void mutate((key) => typeof key === "string" && (key.startsWith("/portfolio") || key === "/plans/orders/open"));
    if (!mounted.current) return;
    const next = nextUnplaced(plan, line.ticker);
    onPlaced?.(line, next);
    setSheetOpen(false);
    setOpenTicker(next?.ticker ?? null);
    setStatus(
      next
        ? `${line.ticker} recorded as placed. Next: ${next.ticker}, opened for you.`
        : `${line.ticker} recorded as placed. All lines placed.`,
    );
    // The panel focuses that card; the sheet's own focus return lands on the Placed button, gone by then.
    setFocusTicker(next?.ticker ?? line.ticker);
    if (!fromOpenOrders) void onChanged(); // the plan, for the placed chip
  }

  return (
    <Box>
      <OrdersPanel
        plan={plan}
        onChanged={onChanged}
        onPlace={place}
        openTicker={openTicker}
        onOpenTickerChange={setOpenTicker}
        status={status}
        focusTicker={focusTicker}
        footer={footer}
        heading={heading}
        notice={notice}
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
