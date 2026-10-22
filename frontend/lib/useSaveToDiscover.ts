"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/api/client";
import { useAction } from "@/lib/useAction";

/**
 * Save one researched company to the Discover list. The request is safe to repeat (a company already
 * in the list is returned as it is), so a second click or a retry never duplicates it. It only adds a
 * list entry; it records no decision and nothing is sent to a broker. `saved` only says this visit
 * saved it: after a reload the button is offered again, and pressing it finds the company already there.
 */
export function useSaveToDiscover(ticker: string, assetType: string) {
  const { run, submitting, error } = useAction();
  const { mutate } = useSWRConfig();
  const [saved, setSaved] = useState(false);

  const save = () =>
    run(async () => {
      await apiFetch("/discover", { method: "POST", body: JSON.stringify({ ticker, asset_type: assetType, source: "today" }) });
      setSaved(true);
      // Drop the cached list and any read of it still in flight (a read started before this save would
      // otherwise be reused when Discover opens). Nothing fetches here: no Discover list is mounted.
      void mutate("/discover", undefined);
    });

  return { save, saving: submitting, saved, problem: error };
}
