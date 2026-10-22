"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { SymbolMatch } from "@/lib/tickerSearch";

const DEBOUNCE_MS = 300;
export const MIN_SEARCH_LENGTH = 2;

/**
 * Stocks and ETFs matching what is typed, from `GET /market/search`, after a short pause and from
 * two characters. `answeredFor` is the text the matches belong to, so the screen can tell "no result
 * for this" from "not asked yet"; a failed search answers with no matches rather than an error, and
 * typing keeps working.
 */
export function useSymbolSearch(text: string) {
  const query = text.trim();
  const [answer, setAnswer] = useState<{ query: string; matches: SymbolMatch[] } | null>(null);
  const searchable = query.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch<SymbolMatch[]>(`/market/search?q=${encodeURIComponent(query)}`)
        .then((matches) => !cancelled && setAnswer({ query, matches: Array.isArray(matches) ? matches : [] }))
        .catch(() => !cancelled && setAnswer({ query, matches: [] }));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchable]);

  const answered = searchable && answer?.query === query;
  return { matches: answered ? answer.matches : [], answered, searching: searchable && !answered };
}
