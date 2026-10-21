"use client";

import { useState } from "react";
import useSWR, { mutate as mutateKey } from "swr";
import { apiFetch } from "@/lib/api/client";
import type { DiscoveryIdeas, DiscoveryJob } from "@/lib/api/discovery-types";
import { isClaudeKeyRequired } from "@/lib/claudeKey";
import { useAction } from "@/lib/useAction";

const UNREADABLE: DiscoveryJob = {
  status: "FAILED",
  stage: "failed",
  total: 0,
  done: 0,
  error: "The scan's progress could not be read.",
};

/**
 * The saved discovery ideas plus a manual scan: start it, poll it, and reload the ideas and the
 * monthly run count when it finishes. The last saved ideas stay on screen while a scan runs or after
 * one fails. `onKeyRequired` fires when the scan is refused for want of a usable Claude key.
 */
export function useDiscovery(onKeyRequired: () => void) {
  const { data, error, mutate } = useSWR<DiscoveryIdeas>("/discovery/ideas", apiFetch);
  const [jobId, setJobId] = useState<string | null>(null);
  const { run, submitting, error: startError } = useAction();

  // jobId is never cleared once set, so a FAILED status stays visible after polling stops.
  const { data: polled, error: pollError } = useSWR<DiscoveryJob>(jobId ? `/discovery/run/${jobId}` : null, apiFetch, {
    refreshInterval: (current) => (current?.status === "RUNNING" ? 2000 : 0),
    revalidateOnFocus: false,
    onSuccess: (current) => {
      if (current.status === "RUNNING") return;
      mutate();
      mutateKey("/me/usage");
    },
  });

  // A poll that errors (unknown job, server restart) ends the scan instead of spinning forever.
  const job = pollError ? UNREADABLE : polled;
  const running = submitting || (jobId !== null && !pollError && (!polled || polled.status === "RUNNING"));

  function start() {
    return run(async () => {
      try {
        const { job_id } = await apiFetch<{ job_id: string }>("/discovery/run", { method: "POST" });
        setJobId(job_id);
      } catch (err) {
        if (!isClaudeKeyRequired(err)) throw err;
        onKeyRequired();
      }
    });
  }

  return { ideas: data, loadError: error, job, running, startError, start };
}
