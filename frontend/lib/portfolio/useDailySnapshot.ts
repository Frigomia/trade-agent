// frontend/lib/portfolio/useDailySnapshot.ts
"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";

// Module-level so moving between Today and Portfolio (each mounts the hook) never retries the same
// day, whether the first attempt worked or not.
let attemptedDay: string | null = null;

/** For tests: forget that a snapshot was already attempted today. */
export function resetDailySnapshotGuard(): void {
  attemptedDay = null;
}

/**
 * Records at most one portfolio snapshot per UTC day, best effort, when Today or Portfolio is
 * opened — there is no backend scheduler, so this is what fills the value-over-time chart. Never
 * records a partial total (any unpriced holding) or an empty portfolio. Two tabs racing can create
 * two same-day snapshots; harmless, the chart keeps the last point per day. Failures are silent —
 * the manual Record snapshot button is where errors show.
 */
export function useDailySnapshot(): void {
  const { data: summary } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { data: snapshots, mutate } = useSWR<Snapshot[]>("/portfolio/snapshots", apiFetch);

  useEffect(() => {
    if (!summary || !snapshots) return;
    if (!summary.holdings.some((h) => h.shares > 0) || summary.unpriced_count > 0) return;

    const today = new Date().toISOString().slice(0, 10);
    const latest = snapshots.at(-1); // the API lists oldest first
    if (latest && latest.created_at.slice(0, 10) === today) return;
    if (attemptedDay === today) return;

    attemptedDay = today;
    apiFetch("/portfolio/snapshot", { method: "POST" })
      .then(() => mutate())
      .catch(() => {});
  }, [summary, snapshots, mutate]);
}
