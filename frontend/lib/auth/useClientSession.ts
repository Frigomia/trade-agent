"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Reads the current browser Supabase session once on mount. Used by pages that render
 * differently depending on whether a Supabase auth link (invite/reset) already put a session in
 * the browser — this can't be known during the first render, only after the client-side SDK
 * checks its storage.
 */
export function useClientSession(): { session: Session | null; checkingSession: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });
  }, []);

  return { session, checkingSession };
}
