"use client";

import Link from "next/link";
import useSWR, { mutate as mutateKey } from "swr";
import { Box, Button, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { CompanyAnalysisState, DiscoverItem } from "@/lib/api/discover-types";
import { useAction } from "@/lib/useAction";
import { useClaudeLock, isClaudeKeyRequired } from "@/lib/claudeKey";
import type { Usage } from "@/lib/usage";
import { nextResetDate } from "@/lib/usage";
import { useState } from "react";

/** Only an explicit click starts research. Every mount and refresh is a free read. */
export function ResearchAction({ item, details = false }: { item: DiscoverItem; details?: boolean }) {
  const state = item.analysis;
  const { lock, markRequired } = useClaudeLock();
  const { data: usage } = useSWR<Usage>("/me/usage", apiFetch);
  const { run, submitting, error } = useAction();
  const [renewal] = useState(() => nextResetDate(new Date()));
  const quota = usage?.analysis_runs;
  const exhausted = quota !== undefined && quota.used >= quota.limit;
  const running = state?.status === "running";
  const saved = item.report_id !== null || state?.status === "no_opportunity" || state?.status === "report";
  const pending = state?.charge_state === "pending";
  const refused = state?.status === "ineligible" && !state.can_analyze;
  const text = running ? "Analyzing · Researching sources" : pending ? "Usage settlement pending" : refused ? "Waiting for eligible data" : exhausted ? "Monthly runs used up" : state?.status === "failed" ? "Try again · 1 monthly run" : "Analyze · 1 monthly run";
  async function start() {
    await run(async () => {
      try {
        await apiFetch<CompanyAnalysisState>(`/discover/${encodeURIComponent(item.ticker)}/analyze`, { method: "POST" });
      } catch (err) {
        if (isClaudeKeyRequired(err)) markRequired();
        throw err;
      } finally {
        await Promise.allSettled([
          mutateKey(`/discover/${encodeURIComponent(item.ticker)}/overview`),
          mutateKey("/discover"), mutateKey("/me/usage"),
        ]);
      }
    });
  }
  if (saved) return null;
  return (
    <Box sx={{ display: "grid", gap: 1, flex: 1, minWidth: 0 }}>
      {details && quota && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{quota.used} of {quota.limit} monthly runs used · {Math.max(0, quota.limit - quota.used)} remaining · renews {renewal}</Typography>}
      {lock ? <Button component={Link} href="/more/account" variant="outlined" sx={{ minHeight: 44 }}>{lock === "reconnect" ? "Reconnect Claude in Account" : "Connect Claude in Account"}</Button> : <Button onClick={() => void start()} disabled={submitting || running || pending || refused || exhausted} variant="contained" sx={{ minHeight: 44 }}>{submitting ? "Starting research…" : text}</Button>}
      {details && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Completed research uses one run, including no opportunity. Refusals and failed runs cost zero. You can leave while research runs.</Typography>}
      {error && <Typography role="alert" sx={{ fontSize: "0.8125rem", color: "var(--warn)" }}>{error}</Typography>}
    </Box>
  );
}
