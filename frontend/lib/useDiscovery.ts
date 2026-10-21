"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import useSWR, { mutate as mutateKey } from "swr";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { DiscoveryIdeas, DiscoveryJob } from "@/lib/api/discovery-types";
import { isClaudeKeyRequired } from "@/lib/claudeKey";
import { useAction } from "@/lib/useAction";

// The running scan's id, kept for the browser tab so leaving Today and coming back (or a refresh)
// resumes the progress instead of forgetting a scan the server is still running.
const STORAGE_KEY = "discovery:job";
const CHANGED = "discovery:job-changed";

function readStoredJob(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage can be blocked; the scan then just is not resumable
  }
}

function writeStoredJob(id: string | null) {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignored: see readStoredJob
  }
  window.dispatchEvent(new Event(CHANGED));
}

function isUnknownJob(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

function subscribe(onChange: () => void) {
  // sessionStorage is per tab, so the browser's own "storage" event never fires for it.
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

/**
 * The saved discovery ideas plus a manual scan: start it, poll it, and reload the ideas and the
 * monthly run count when it finishes. The last saved ideas stay on screen while a scan runs or after
 * one fails, and a scan still running when the page was left is picked up again.
 *
 * Reading the job's status can fail without the scan failing: `progressUnavailable` means the read
 * is failing and is retried while the scan is treated as still running (so a second one cannot be
 * started into the server's one-scan lock); `lost` means the server no longer knows the scan this
 * page started. `job.status === "FAILED"` is only ever the server's own answer.
 * `onKeyRequired` fires when the scan is refused for want of a usable Claude key.
 */
export function useDiscovery(onKeyRequired: () => void) {
  const { data, error, mutate } = useSWR<DiscoveryIdeas>("/discovery/ideas", apiFetch);
  // Null on the server and on the first client render, so hydration matches.
  const stored = useSyncExternalStore(subscribe, readStoredJob, () => null);
  // The id of a scan this page started or took over, kept after it ends so a FAILED status stays visible.
  const [own, setOwn] = useState<string | null>(null);
  const jobId = own ?? stored;
  const finished = useRef<string | null>(null); // the job whose end was already handled
  const { run, submitting, error: startError } = useAction();

  const { data: polled, error: pollError, mutate: recheck } = useSWR<DiscoveryJob>(jobId ? `/discovery/run/${jobId}` : null, apiFetch, {
    refreshInterval: (current) => (current?.status === "RUNNING" ? 2000 : 0),
    revalidateOnFocus: false,
    onSuccess: (current) => {
      if (current.status === "RUNNING" || finished.current === jobId) return;
      // Finished: keep it for this page, stop resuming it on the next visit, reload the data once.
      finished.current = jobId;
      setOwn(jobId);
      writeStoredJob(null);
      mutate();
      mutateKey("/me/usage");
    },
    // Only an id the server does not know is dropped (and the ideas reloaded, as the scan may have
    // finished); a network blip or a 5xx keeps the scan resumable and is retried by SWR.
    onError: (err) => {
      if (!isUnknownJob(err)) return;
      writeStoredJob(null);
      mutate();
      mutateKey("/me/usage");
    },
  });

  const gone = isUnknownJob(pollError);
  // Still going as far as anyone knows: no answer yet, or the last answer said so.
  const running = submitting || (jobId !== null && !gone && (!polled || polled.status === "RUNNING"));
  const progressUnavailable = !!pollError && !gone && running;
  // Only for a scan this page started: an id left over from an earlier visit is dropped quietly.
  const lost = gone && own !== null;

  function start() {
    return run(async () => {
      try {
        const { job_id } = await apiFetch<{ job_id: string }>("/discovery/run", { method: "POST" });
        setOwn(job_id);
        writeStoredJob(job_id);
      } catch (err) {
        if (!isClaudeKeyRequired(err)) throw err;
        onKeyRequired();
      }
    });
  }

  return { ideas: data, loadError: error, job: polled, running, startError, start, progressUnavailable, lost, recheck: () => recheck() };
}
