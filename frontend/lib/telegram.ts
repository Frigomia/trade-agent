"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";

export interface TelegramStatus {
  configured: boolean;
  linked: boolean;
  status: "ok" | "blocked" | null;
  digest_enabled: boolean;
  moves_enabled: boolean;
  move_threshold_pct: number;
  bot_username: string | null;
}

export interface TelegramLink {
  url: string;
  expires_in: number;
}

export type TelegramPatch = Partial<Pick<TelegramStatus, "digest_enabled" | "moves_enabled" | "move_threshold_pct">>;

const PATH = "/me/telegram";
const POLL_MS = 3000;

/**
 * The caller's Telegram status. `connect`, `update` and `disconnect` throw the ApiError (run them
 * inside `useAction`). The one-time link code only travels in the return value of `connect`: the
 * hook keeps just the lifetime, so it can poll for the link until it is made or has expired.
 */
export function useTelegram() {
  // Seconds the code lives; a fresh object per connect() restarts the timer.
  const [wait, setWait] = useState<{ seconds: number } | null>(null);
  // Stable between renders: SWR restarts its poll timer whenever this function changes.
  const refreshInterval = useCallback(
    (latest?: TelegramStatus) => (wait && !latest?.linked ? POLL_MS : 0),
    [wait],
  );
  const { data, error, isLoading, mutate } = useSWR<TelegramStatus>(PATH, apiFetch, { refreshInterval });
  const isLinked = data?.linked === true;

  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait(null), wait.seconds * 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function connect(): Promise<TelegramLink> {
    const link = await apiFetch<TelegramLink>(`${PATH}/link`, { method: "POST" });
    setWait({ seconds: link.expires_in });
    return link;
  }

  async function update(patch: TelegramPatch): Promise<void> {
    await mutate(apiFetch<TelegramStatus>(PATH, { method: "PATCH", body: JSON.stringify(patch) }));
  }

  async function disconnect(): Promise<void> {
    await apiFetch<void>(PATH, { method: "DELETE" });
    setWait(null);
    await mutate();
  }

  return {
    status: data,
    error,
    isLoading,
    waiting: wait !== null && !isLinked,
    connect,
    update,
    disconnect,
    refresh: mutate,
  };
}
