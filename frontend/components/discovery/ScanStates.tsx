import type { ReactNode } from "react";
import { Box, LinearProgress, Typography } from "@mui/material";
import { Panel } from "@/components/ui/Panel";
import type { DiscoveryJob, ScanRun } from "@/lib/api/discovery-types";

function State({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel sx={{ p: 3, display: "grid", gap: 1, justifyItems: "start" }}>
      <Typography component="h3" sx={{ fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.02em" }}>
        {title}
      </Typography>
      {children}
    </Panel>
  );
}

const body = { fontSize: "0.8125rem", color: "var(--text2)", lineHeight: 1.5, maxWidth: "52ch" } as const;

/** A scan is running: a determinate bar once the total is known, with the stage in words. */
export function ScanRunning({ job }: { job: DiscoveryJob | undefined }) {
  const total = job?.total ?? 0;
  const done = job?.done ?? 0;
  return (
    <State title="Scanning the market">
      <Typography sx={body}>
        Stage: {job?.stage ?? "starting"}. This takes a few minutes; your last saved ideas stay below until it finishes.
      </Typography>
      <LinearProgress
        sx={{ width: "100%" }}
        variant={total > 0 ? "determinate" : "indeterminate"}
        value={total > 0 ? (done / total) * 100 : undefined}
        aria-label="Scan progress"
      />
    </State>
  );
}

/** The scan finished and no company reached the bar. A result, not an error, with the nearest misses named. */
export function NoOpportunity({ scan }: { scan: ScanRun }) {
  const misses = scan.coverage_summary.nearest_misses ?? [];
  return (
    <State title="No compelling opportunity today">
      <Typography sx={body}>
        No company reached the score and confidence bar. That is a result, not an error.
      </Typography>
      {misses.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5, ...body }}>
          {misses.map((miss) => (
            <li key={miss.ticker}>
              <b>{miss.name ?? miss.ticker}</b> ({miss.ticker}) · {miss.overall ?? "no"} points · {miss.confidence} confidence
            </li>
          ))}
        </Box>
      )}
    </State>
  );
}

/** No scan has ever run for this account. */
export function FirstScan() {
  return (
    <State title="Run your first scan">
      <Typography sx={body}>
        A scan researches companies from a global list and keeps the few worth a look, each with its reasoning and its risks. It uses one of your monthly runs.
      </Typography>
    </State>
  );
}

/** The last scan failed. Nothing was saved; the previous ideas are still below. */
export function ScanFailed({ message }: { message: string | null }) {
  return (
    <State title="The scan did not finish">
      <Typography sx={body}>
        {(message ?? "Something went wrong").replace(/[.!?\s]*$/, ".")} Nothing was saved.
      </Typography>
    </State>
  );
}
