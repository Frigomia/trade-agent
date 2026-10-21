"use client";

import { useState } from "react";
import { Alert, Box, Button, Typography } from "@mui/material";
import type { DiscoveryIdeas, DiscoveryJob } from "@/lib/api/discovery-types";
import { splitIdeas } from "@/lib/discovery";
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
export function DiscoveryFeed({ ideas, loadError, job, running, startError, usage, locked, now, onRun }: Props) {
  const [showAll, setShowAll] = useState(false);
  const scan = ideas?.latest_scan ?? null;
  const recs = ideas?.recommendations ?? [];
  const { top, others, more } = splitIdeas(recs);
  // "Show more" lists the ideas beyond the top one and the three shown.
  const extra = showAll ? recs.filter((r) => r.idea).slice(1 + others.length) : [];
  const failed = !running && job?.status === "FAILED";

  return (
    <Box component="section" aria-label="Discovery" sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 2, mt: 2 }}>
      <ScanBar scan={scan} job={job} running={running} usage={usage} locked={locked} now={now} onRun={onRun} />
      {loadError ? <Alert severity="error">Your saved ideas are unavailable right now.</Alert> : null}
      {startError && <Alert severity="error">{startError}</Alert>}
      {running && <ScanRunning job={job} universe={scan?.universe_size} />}
      {failed && <ScanFailed message={job?.error ?? null} locked={locked} onRetry={onRun} />}
      {!running && !failed && ideas && !scan && <FirstScan />}
      {!running && !failed && scan && !top && scan.outcome === "none" && <NoOpportunity scan={scan} />}
      {top && (
        <>
          <Typography component="h2" sx={heading}>
            Top opportunity
          </Typography>
          <TopOpportunity rec={top} />
          {others.length > 0 && (
            <>
              <Typography component="h2" sx={heading}>
                Other opportunities
              </Typography>
              <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" } }}>
                {[...others, ...extra].map((rec) => (
                  <OpportunityCard key={rec.id} rec={rec} />
                ))}
              </Box>
              {more > 0 && !showAll && (
                <Box>
                  <Button size="small" variant="text" onClick={() => setShowAll(true)} sx={{ minHeight: { xs: 44, md: 36 } }}>
                    Show {more} more
                  </Button>
                </Box>
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
}
