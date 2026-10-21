"use client";

import { useState } from "react";
import { Alert, Box, Button, Typography } from "@mui/material";
import { ChevronRight } from "lucide-react";
import type { DiscoveryIdeas, DiscoveryJob } from "@/lib/api/discovery-types";
import { isEarlier, pricesAsOf, runsExhausted, splitIdeas } from "@/lib/discovery";
import type { UsageDetail } from "@/lib/usage";
import { OpportunityCard } from "./OpportunityCard";
import { ScanBar } from "./ScanBar";
import { FirstScan, NoOpportunity, ScanFailed, ScanRunning } from "./ScanStates";
import { TopOpportunity } from "./TopOpportunity";

interface Props {
  ideas: DiscoveryIdeas | undefined;
  loadError: unknown;
  job: DiscoveryJob | undefined;
  running: boolean;
  startError: string | null;
  /** Reading the scan's progress is failing, but the scan may still be running. */
  progressUnavailable?: boolean;
  /** The server no longer knows the scan this page started. */
  lost?: boolean;
  onRecheck?: () => void;
  usage?: UsageDetail;
  locked: boolean;
  now: number;
  onRun: () => void;
}

const heading = { fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em", mt: 1 } as const;

/**
 * Today's discovery section: the scan bar, then either the ranked ideas or the state that explains
 * why there are none. The last saved ideas stay visible while a scan runs or after one fails.
 */
export function DiscoveryFeed({ ideas, loadError, job, running, startError, progressUnavailable = false, lost = false, onRecheck, usage, locked, now, onRun }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [lostSeen, setLostSeen] = useState(false); // the "no longer available" note can be dismissed
  const scan = ideas?.latest_scan ?? null;
  const recs = ideas?.recommendations ?? [];
  const { top, others, more } = splitIdeas(recs);
  // "Show more" lists the ideas beyond the top one and the three shown.
  const extra = showAll ? recs.filter((r) => r.idea).slice(1 + others.length) : [];
  const asOf = pricesAsOf([...others, ...extra]);
  const failed = !running && job?.status === "FAILED";

  return (
    <Box component="section" aria-label="Discovery" sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 2, mt: 2 }}>
      <ScanBar scan={scan} job={job} running={running} usage={usage} locked={locked} now={now} onRun={onRun} />
      {loadError ? <Alert severity="error">Your saved ideas are unavailable right now.</Alert> : null}
      {startError && <Alert severity="error">{startError}</Alert>}
      {progressUnavailable && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={onRecheck}>
              Check now
            </Button>
          }
        >
          The scan&apos;s progress can&apos;t be read right now. It may still be running, so another scan stays off until this is
          settled. Trying again automatically.
        </Alert>
      )}
      {lost && !lostSeen && (
        <Alert severity="info" onClose={() => setLostSeen(true)}>
          This scan&apos;s progress is no longer available. Your saved ideas below are as of now.
        </Alert>
      )}
      {running && <ScanRunning job={job} universe={scan?.universe_size} />}
      {failed && <ScanFailed message={job?.error ?? null} locked={locked} exhausted={runsExhausted(usage)} onRetry={onRun} />}
      {!running && !failed && ideas && !scan && <FirstScan />}
      {/* The latest scan's result shows even when older ideas are still pending below. */}
      {!running && !failed && scan && scan.outcome === "none" && <NoOpportunity scan={scan} />}
      {top && (
        <>
          <Typography component="h2" sx={heading}>
            Top opportunity
          </Typography>
          <TopOpportunity rec={top} earlier={isEarlier(top, scan)} />
          {others.length > 0 && (
            <>
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, flexWrap: "wrap", mt: 1 }}>
                <Typography component="h2" sx={{ ...heading, mt: 0 }}>
                  Other opportunities
                </Typography>
                {asOf && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Prices as of {asOf}</Typography>}
                <Box sx={{ flex: 1 }} />
                {more > 0 && (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setShowAll((open) => !open)}
                    endIcon={<ChevronRight size={14} aria-hidden style={{ transform: showAll ? "rotate(-90deg)" : "none" }} />}
                    sx={{ minHeight: { xs: 44, md: 36 }, fontSize: "0.8125rem", fontWeight: 500 }}
                  >
                    {showAll ? "Show fewer" : `View all ${others.length + more}`}
                  </Button>
                )}
              </Box>
              <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" } }}>
                {[...others, ...extra].map((rec) => (
                  <OpportunityCard key={rec.id} rec={rec} earlier={isEarlier(rec, scan)} />
                ))}
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
}
