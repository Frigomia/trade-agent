"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import useSWR, { mutate as mutateKey } from "swr";
import { apiFetch, ApiError } from "@/lib/api/client";
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

  const { data: polled, error: pollError } = useSWR<DiscoveryJob>(jobId ? `/discovery/run/${jobId}` : null, apiFetch, {
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
    // Only an id the server does not know is dropped; a network blip or a 5xx keeps the scan resumable.
    onError: (err) => {
      if (isUnknownJob(err)) writeStoredJob(null);
    },
  });

  // A poll that errors says so instead of spinning forever, and recovers if a retry succeeds. An id
  // taken over from an earlier visit that the server no longer knows (expired, restarted) is dropped
  // quietly.
  const job = pollError ? (isUnknownJob(pollError) && !own ? undefined : UNREADABLE) : polled;
  const running = submitting || (jobId !== null && !pollError && (!polled || polled.status === "RUNNING"));

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

  return { ideas: data, loadError: error, job, running, startError, start };
}
