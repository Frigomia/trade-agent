"use client";

import { useEffect, useEffectEvent } from "react";

/** Runs `fn` each time `active` turns true (and on mount when it starts true); only `active` re-runs it. */
export function useWhenActive(active: boolean, fn: () => void) {
  const run = useEffectEvent(fn);
  useEffect(() => {
    if (active) run();
  }, [active]);
}
