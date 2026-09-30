"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api/client";

/**
 * The submit boilerplate every form and action button shares: one request at a time (a second
 * call while one is in flight is ignored), the error message cleared at the start and taken from
 * `ApiError.detail` on failure, the in-flight flag cleared at the end. Anything the caller wants
 * to happen on success (refetch, close, callback) goes inside the action, so a throw there is shown
 * the same way. `setError` is for validation messages the caller raises itself.
 */
export function useAction() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return { run, submitting, error, setError };
}
