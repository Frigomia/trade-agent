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
 *
 * A removal that succeeded is taken out of the shared list itself (the SWR cache), before the local
 * hiding is let go, so the company cannot return when the list is read again and fails, or when the
 * page was left and opened again while the removal was on its way.
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

  /** Sends the removal. True when the company is gone (removed, or already not there). */
  const deleteOnServer = async (item: DiscoverItem): Promise<boolean> => {
    try {
      await apiFetch(`/portfolio/watchlist/${encodeURIComponent(item.ticker)}`, { method: "DELETE" });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return true; // already gone is what was wanted
      if (alive.current) setProblem(`Could not remove ${nameOf(item)}: ${err instanceof ApiError ? err.detail : "something went wrong"}.`);
      return false;
    }
  };

  /**
   * Takes the company out of the shared list at once, then reads the list again in the background (a
   * read that started before the removal finished may still have it). A failure of either is
   * ignored: the cache already says it is gone, and the next read confirms.
   */
  const forget = async (ticker: string) => {
    try {
      await mutate((cur) => cur && { ...cur, items: cur.items.filter((i) => i.ticker !== ticker) }, { revalidate: false });
      void mutate().catch(() => undefined);
    } catch {
      /* the list is read again next time */
    }
  };

  /** Puts a saved edit on the shared list at once: the answer has no quote, so only the edited fields. */
  const applyEdit = (updated: DiscoverItem) =>
    mutate(
      (cur) =>
        cur && {
          ...cur,
          items: cur.items.map((i) =>
            i.ticker === updated.ticker
              ? { ...i, note: updated.note, target_weight: updated.target_weight, target_price_low: updated.target_price_low, target_price_high: updated.target_price_high, owned: updated.owned }
              : i,
          ),
        },
      { revalidate: false },
    );

  const sendRemoval = async (item: DiscoverItem) => {
    timers.current.delete(item.ticker);
    setRemoved((list) => list.map((r) => (r.item.ticker === item.ticker ? { ...r, sent: true } : r)));
    const gone = await deleteOnServer(item);
    if (gone) await forget(item.ticker); // before the local hiding is let go
    if (!alive.current) return;
    drop(item.ticker);
    if (!gone) void mutate().catch(() => undefined); // a failed removal: read the list to be sure of it
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
  // One already being sent is left to finish. `leave` always holds the latest closure, so the
  // cleanup below, which runs once, never uses a stale one.
  const leave = useRef(() => {});
  useEffect(() => {
    leave.current = () => {
      alive.current = false;
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      // They finish after the page is gone: each takes itself out of the shared list when it is done.
      for (const { item, sent } of latest.current) {
        if (!sent) {
          void deleteOnServer(item).then(async (gone) => {
            if (gone) await forget(item.ticker);
          });
        }
      }
    };
  });
  useEffect(() => {
    alive.current = true;
    return () => leave.current();
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
    applyEdit,
    add,
    remove,
    undo,
  };
}
