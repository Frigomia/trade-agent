"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioAlerts } from "@/lib/api/alert-types";

/**
 * The typed alerts on the user's holdings. A failure (the endpoint not deployed yet, the provider
 * down) leaves `alerts` undefined, and the panel falls back to the pending calls; it is not retried
 * in a loop (only on the next return to the tab) and never shown as an error next to the page's
 * real content.
 */
export function useAlerts() {
  const { data } = useSWR<PortfolioAlerts>("/portfolio/alerts", apiFetch, {
    shouldRetryOnError: false,
    // Prices and earnings dates move, so coming back to the tab refreshes them, at most every five
    // minutes (the quote cache's own life); this also recovers from a failed first load.
    focusThrottleInterval: 300_000,
  });
  return data;
}
