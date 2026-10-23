// frontend/lib/portfolio/useDailySnapshot.ts
"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioSummary, Snapshot } from "@/lib/api/portfolio-types";
import { todayIso } from "@/lib/format";

// Module-level so moving between Today and Portfolio (each mounts the hook) never repeats a save that
// worked, or one still running. A failed save clears it, so the next visit tries again.
let attemptedDay: string | null = null;

// The day a save failed, shared so the page that is open when a save fails after the person moved
// from the page that started it still hears about it.
let failedDay: string | null = null;
const listeners = new Set<() => void>();
function setFailedDay(day: string | null) {
  failedDay = day;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** For tests: forget that a snapshot was already attempted, or failed, today. */
export function resetDailySnapshotGuard(): void {
  attemptedDay = null;
  failedDay = null;
}

const MAX_NAMED = 3;

/**
 * Why today's value is not on the chart, in words, or null when nothing needs saying: a snapshot from
 * today exists, or there are no open positions. An unpriced holding is named, because it is what keeps
 * the day from being saved; a failed save says it will be tried again.
 */
export function snapshotNote(
  summary: PortfolioSummary | undefined,
  snapshots: Snapshot[] | undefined,
  today: string,
  saveFailed: boolean,
): string | null {
  if (!summary || !snapshots) return null;
  const open = summary.holdings.filter((h) => h.shares > 0);
  if (open.length === 0) return null;
  const latest = snapshots.at(-1); // the API lists oldest first
  if (latest && latest.created_at.slice(0, 10) === today) return null;

  if (summary.unpriced_count > 0) {
    const names = open.filter((h) => h.current_price === null).map((h) => h.ticker);
    // "A has", "A and B have", "A, B and C have", "A, B, C and 2 more have".
    const listed = names.slice(0, MAX_NAMED);
    const rest = names.length - listed.length;
    const parts = rest > 0 ? [...listed, `${rest} more`] : listed;
    const who = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? `${summary.unpriced_count} holding${summary.unpriced_count === 1 ? "" : "s"}`);
    const has = parts.length > 1 || (parts.length === 0 && summary.unpriced_count !== 1) ? "have" : "has";
    return `Today's value was not saved because ${who} ${has} no live price.`;
  }
  if (saveFailed) return "Today's value could not be saved. It is tried again the next time you open Today or Portfolio.";
  return null;
}

/**
 * Records at most one portfolio snapshot per UTC day, best effort, when Today or Portfolio is
 * opened — there is no backend scheduler, so this is what fills the value-over-time chart. Never
 * records a partial total (any unpriced holding) or an empty portfolio. Two tabs racing can create
 * two same-day snapshots; harmless, the chart keeps the last point per day. A failed save is tried
 * again on the next visit (not in the same one), and `note` says why a day is missing.
 */
export function useDailySnapshot(): { note: string | null } {
  const { data: summary } = useSWR<PortfolioSummary>("/portfolio/summary", apiFetch);
  const { data: snapshots, mutate } = useSWR<Snapshot[]>("/portfolio/snapshots", apiFetch);
  const [today] = useState(todayIso);
  const failed = useSyncExternalStore(subscribe, () => failedDay, () => null);
  const triedHere = useRef(false); // one attempt per visit: a failure waits for the next one

  useEffect(() => {
    if (!summary || !snapshots || triedHere.current) return;
    if (!summary.holdings.some((h) => h.shares > 0) || summary.unpriced_count > 0) return;

    const day = todayIso();
    const latest = snapshots.at(-1); // the API lists oldest first
    if (latest && latest.created_at.slice(0, 10) === day) return;
    if (attemptedDay === day) return;

    attemptedDay = day;
    triedHere.current = true;
    apiFetch("/portfolio/snapshot", { method: "POST" })
      .then(
        () => {
          setFailedDay(null);
          return mutate();
        },
        () => {
          attemptedDay = null;
          setFailedDay(day);
        },
      )
      .catch(() => {});
  }, [summary, snapshots, mutate]);

  return { note: snapshotNote(summary, snapshots, today, failed === today) };
}
