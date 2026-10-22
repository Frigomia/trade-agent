"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ApiError, apiFetch } from "@/lib/api/client";
import type { DiscoverItem, DiscoverList } from "@/lib/api/discover-types";
import type { SymbolMatch } from "@/lib/tickerSearch";
import { nameOf } from "@/lib/discoverList";

/** How long Undo stays possible. The removal is only sent when it runs out (or the page is left). */
export const UNDO_MS = 8000;

const norm = (ticker: string) => ticker.trim().toUpperCase();

/** A company hidden from the list: waiting for its removal to be sent, or already being sent. */
interface Removal {
  item: DiscoverItem;
  sent: boolean;
}

const removalText = (item: DiscoverItem) => `Removed ${nameOf(item)} from Discover. It only leaves this list.`;

/**
 * The Discover list and what can be done to it. Remove is shown at once but only sent after
 * `UNDO_MS`: Undo just cancels it, so nothing the person had set on the company (a note, a target) is
 * ever lost to a delete and re-add. Leaving the page sends the removals still waiting; a removal
 * that fails brings the company back with a message, and one that finds the company already gone
 * counts as done. Adding a company that is waiting to be removed cancels the removal instead; one
 * already being sent is not added until it is gone.
 */
export function useDiscoverList() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<DiscoverList>("/discover", apiFetch, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });
  const [removed, setRemoved] = useState<Removal[]>([]);
  // `undoable` notices (a removal) are shown only while there is still something to undo.
  const [message, setMessage] = useState<{ text: string; undoable: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // The latest removals, for the cleanup that runs when the page is left.
  const latest = useRef<Removal[]>([]);
  // False once the page is left: what a removal finishing later would update is gone.
  const alive = useRef(true);
  useEffect(() => {
    latest.current = removed;
  }, [removed]);

  const waiting = removed.filter((r) => !r.sent);
  const drop = (ticker: string) => setRemoved((list) => list.filter((r) => r.item.ticker !== ticker));
  const cancel = (ticker: string) => {
    clearTimeout(timers.current.get(ticker));
    timers.current.delete(ticker);
  };

  const sendRemoval = async (item: DiscoverItem) => {
    timers.current.delete(item.ticker);
    setRemoved((list) => list.map((r) => (r.item.ticker === item.ticker ? { ...r, sent: true } : r)));
    try {
      await apiFetch(`/portfolio/watchlist/${encodeURIComponent(item.ticker)}`, { method: "DELETE" });
    } catch (err) {
      // Already gone is what was wanted. Anything else: it comes back, and the person is told.
      if (!(err instanceof ApiError && err.status === 404)) {
        if (alive.current) setProblem(`Could not remove ${nameOf(item)}: ${err instanceof ApiError ? err.detail : "something went wrong"}.`);
      }
    }
    if (!alive.current) return;
    drop(item.ticker);
    void mutate();
  };

  const remove = (item: DiscoverItem) => {
    setProblem(null);
    setRemoved((list) => [...list.filter((r) => r.item.ticker !== item.ticker), { item, sent: false }]);
    setMessage({ text: removalText(item), undoable: true });
    cancel(item.ticker);
    timers.current.set(item.ticker, setTimeout(() => void sendRemoval(item), UNDO_MS));
  };

  const undo = () => {
    const last = waiting.at(-1);
    if (!last) return;
    cancel(last.item.ticker);
    drop(last.item.ticker);
    // The notice follows what can still be undone: the removal before this one, or nothing.
    const before = waiting.at(-2);
    setMessage(before ? { text: removalText(before.item), undoable: true } : { text: `Restored ${nameOf(last.item)}.`, undoable: false });
  };

  /** Adds a search result, or brings back the same company if it was just removed. */
  const add = async (match: SymbolMatch): Promise<boolean> => {
    setProblem(null);
    const same = removed.find((r) => norm(r.item.ticker) === norm(match.symbol));
    if (same?.sent) {
      setProblem(`${nameOf(same.item)} is still being removed. Try again in a moment.`);
      return false;
    }
    if (same) {
      cancel(same.item.ticker);
      drop(same.item.ticker);
      setMessage({ text: `Restored ${nameOf(same.item)}.`, undoable: false });
      return true;
    }
    try {
      await apiFetch("/discover", { method: "POST", body: JSON.stringify({ ticker: match.symbol, asset_type: match.type, source: "manual" }) });
    } catch (err) {
      setProblem(err instanceof ApiError ? err.detail : "Could not add it. Try again.");
      return false;
    }
    setMessage({ text: `Added ${match.name}. Name, exchange and currency were filled in.`, undoable: false });
    // The add worked; if reading the list again fails, the next refresh shows it.
    await mutate().catch(() => undefined);
    return true;
  };

  // Leaving the page sends what is still waiting: nothing the person removed comes back later.
  // One already being sent is left to finish.
  useEffect(() => {
    const live = timers.current;
    alive.current = true;
    return () => {
      alive.current = false;
      for (const timer of live.values()) clearTimeout(timer);
      live.clear();
      for (const { item, sent } of latest.current) {
        if (!sent) void apiFetch(`/portfolio/watchlist/${encodeURIComponent(item.ticker)}`, { method: "DELETE" }).catch(() => undefined);
      }
    };
  }, []);

  const items = (data?.items ?? []).filter((i) => !removed.some((r) => r.item.ticker === i.ticker));
  return {
    items,
    pricesMissing: (data?.missing.length ?? 0) > 0,
    loading: isLoading,
    refreshing: isValidating,
    failed: !!error && data === undefined,
    canUndo: waiting.length > 0,
    notice: message && (!message.undoable || waiting.length > 0) ? message.text : null,
    problem,
    dismissNotice: () => setMessage(null),
    refresh: () => mutate(),
    add,
    remove,
    undo,
  };
}
