"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import type { WatchlistInsights } from "@/lib/api/insight-types";

/**
 * Watchlist items whose price is inside the target range the person set. Like the alerts, a failed
 * load leaves it undefined (no panel, no error next to the page's real content) and is not retried
 * in a loop, only on the next return to the tab, at most every five minutes.
 */
export function useInsights() {
  const { data } = useSWR<WatchlistInsights>("/portfolio/insights", apiFetch, {
    shouldRetryOnError: false,
    focusThrottleInterval: 300_000,
  });
  return data;
}

/** A sentence for what could not be checked, or null when everything was. */
export function insightsMissingNote(missing: WatchlistInsights["missing"]): string | null {
  return missing.length > 0 ? "Could not check some prices, so watchlist insights may be missing." : null;
}
