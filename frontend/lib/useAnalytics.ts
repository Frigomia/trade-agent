"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import type { PortfolioAnalytics } from "@/lib/api/analytics-types";

/**
 * The portfolio's measured risk. The route fetches a year of prices for every holding and is limited
 * to five requests a minute, so it is read only when there is something to measure, not retried in a
 * loop, and not refetched on every return to the tab. `holdings` (the open positions as a string)
 * is part of the key, so the figures are read again after a holding changes, while the old ones stay
 * on screen until the new ones arrive. A failed refresh is reported, not hidden behind the old figures.
 */
export function useAnalytics(holdings: string | null) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<PortfolioAnalytics, Error, [string, string] | null>(
    holdings === null ? null : ["/portfolio/analytics", holdings],
    ([path]) => apiFetch<PortfolioAnalytics>(path),
    { shouldRetryOnError: false, revalidateOnFocus: false, dedupingInterval: 60_000, keepPreviousData: true },
  );
  return {
    analytics: data,
    /** Nothing to show and the request failed. */
    failed: !!error && data === undefined,
    /** There are figures, but they are from before the last change and the refresh failed. */
    refreshFailed: !!error && data !== undefined,
    loading: isLoading,
    retrying: isValidating,
    retry: () => mutate(),
  };
}
