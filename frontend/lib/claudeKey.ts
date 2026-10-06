"use client";

import { useState } from "react";
import useSWR from "swr";
import { ApiError, apiFetch } from "@/lib/api/client";

export interface ClaudeKeyStatus {
  connected: boolean;
  last4: string | null;
  needs_attention: boolean;
}

const PATH = "/me/claude-key";

/** True when POST /chat or /analysis/run refused because the user has no usable Claude key. */
export function isClaudeKeyRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === "claude_key_required";
}

/**
 * The caller's Claude key status. `save` and `remove` throw the ApiError (run them inside
 * `useAction`). The key string only travels in the PUT body: the hook keeps just the response.
 */
export function useClaudeKey(onStatus?: (status: ClaudeKeyStatus) => void) {
  const { data, error, isLoading, mutate } = useSWR<ClaudeKeyStatus>(PATH, apiFetch, { onSuccess: onStatus });

  async function save(apiKey: string): Promise<void> {
    // The PUT response becomes the cached status; SWR then revalidates with GET.
    await mutate(
      apiFetch<ClaudeKeyStatus>(PATH, { method: "PUT", body: JSON.stringify({ api_key: apiKey }) }),
    );
  }

  async function remove(): Promise<void> {
    await apiFetch<void>(PATH, { method: "DELETE" });
    await mutate();
  }

  return { status: data, error, isLoading, save, remove, refresh: mutate };
}

export type ClaudeLock = "connect" | "reconnect" | null;

/**
 * Whether Chat and Run analysis are locked behind a Claude key, and `markRequired` for when a
 * request answers 409 claude_key_required (a key revoked mid-session). Unknown never locks: while
 * the status loads, or if it fails to load, the normal UI shows and the backend still enforces.
 * An admin with no personal key uses the server key, so only a flagged key locks an admin.
 */
export function useClaudeLock(): { lock: ClaudeLock; markRequired: () => void } {
  const [forced, setForced] = useState(false);
  // A refetch that finds the key usable again (e.g. back from reconnecting) lifts the forced lock.
  const { status, refresh } = useClaudeKey((s) => {
    if (s.connected && !s.needs_attention) setForced(false);
  });
  const needsRole = status !== undefined && !status.connected;
  const { data: me } = useSWR<{ role: string }>(needsRole ? "/me" : null, apiFetch);

  let lock: ClaudeLock = null;
  if (forced || status?.needs_attention) lock = "reconnect";
  else if (needsRole && me?.role === "user") lock = "connect";

  return {
    lock,
    markRequired: () => {
      setForced(true);
      void refresh();
    },
  };
}
