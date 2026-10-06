"use client";

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
export function useClaudeKey() {
  const { data, error, isLoading, mutate } = useSWR<ClaudeKeyStatus>(PATH, apiFetch);

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

  return { status: data, error, isLoading, save, remove };
}
