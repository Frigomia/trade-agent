"use client";

import { useSWRConfig } from "swr";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { useAction } from "@/lib/useAction";

/**
 * Approve or dismiss one recommendation. Approving only records the decision. On a 409 (already
 * decided, or replaced by a newer analysis) the reason is shown and the lists and the detail are
 * refetched so a stale card updates. One request at a time.
 */
export function useDecision(id: number, onDecided: (updated: RecommendationOut) => void) {
  const { run, submitting, error, setError } = useAction();
  const { mutate } = useSWRConfig();

  const decide = (action: "approve" | "reject") =>
    run(async () => {
      try {
        const updated = await apiFetch<RecommendationOut>(`/analysis/recommendations/${id}/${action}`, { method: "POST" });
        void mutate("/portfolio/alerts"); // a decided call is no longer an alert
        onDecided(updated);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setError(err.detail);
          void mutate(
            (key) => typeof key === "string" && (key.startsWith("/analysis/recommendations") || key === "/portfolio/alerts"),
          );
          return;
        }
        throw err;
      }
    });

  return { decide, submitting, error };
}
