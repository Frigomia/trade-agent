"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import type { HistoryRange, PriceHistory } from "@/lib/api/discovery-types";

/**
 * The price history behind a saved idea, for one range at a time. A failure (the endpoint not
 * deployed yet, an unknown id, the provider down) is "unavailable", not an error to retry in a
 * loop: the page keeps working and says so.
 */
export function useIdeaHistory(recommendationId: number) {
  const [range, setRange] = useState<HistoryRange>("1y");
  const { data, error, isLoading } = useSWR<PriceHistory>(
    `/discovery/ideas/${recommendationId}/history?range=${range}`,
    apiFetch,
    { shouldRetryOnError: false, revalidateOnFocus: false, keepPreviousData: true },
  );
  return { range, setRange, history: data, unavailable: !!error, loading: isLoading };
}
