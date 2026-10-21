import { Box, Button, Typography } from "@mui/material";
import { RefreshCw, Sparkles } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { DiscoveryJob, ScanRun } from "@/lib/api/discovery-types";
import { runsExhausted, scanCounts, whenText } from "@/lib/discovery";
import type { UsageDetail } from "@/lib/usage";

interface Props {
  scan: ScanRun | null;
  job: DiscoveryJob | undefined;
  running: boolean;
  /** Runs used this month; shown on the button so the cost of a refresh is never a surprise. */
  usage?: UsageDetail;
  /** No usable Claude key: the button stays off. */
  locked: boolean;
  now: number;
  onRun: () => void;
}

/** The one-line summary of the latest scan, with the refresh button. */
export function ScanBar({ scan, job, running, usage, locked, now, onRun }: Props) {
  const failed = !running && job?.status === "FAILED";
  let text: React.ReactNode;
  if (running) {
    text = (
      <>
        <b>Scanning now</b> · researching {job?.done ?? 0} of {job?.total ?? 0}
      </>
    );
  } else if (failed) {
    text = <b>Last scan did not finish</b>;
  } else if (scan) {
    text = (
      <>
        <b>Latest AI scan</b> · Updated {whenText(scan.created_at, now)}
        {scanCounts(scan).map((part) => ` · ${part}`)}
      </>
    );
  } else {
    text = <b>No scan yet</b>;
  }
  const atLimit = runsExhausted(usage);
  const label = failed ? "Try again" : usage ? `${usage.used} of ${usage.limit} runs` : "Run scan";
  return (
    <Panel sx={{ display: "flex", alignItems: "center", gap: 1.5, p: "10px 14px", flexWrap: "wrap" }}>
      <Box
        aria-hidden
        sx={{ width: 34, height: 34, borderRadius: "12px", display: "grid", placeItems: "center", bgcolor: "var(--accent-wash)", color: "var(--accent)", flex: "none" }}
      >
        <Sparkles size={15} />
      </Box>
      <Typography role="status" sx={{ flex: 1, minWidth: 0, fontSize: "0.8125rem", color: "var(--text2)" }}>
        {text}
      </Typography>
      <Button
        variant="outlined"
        size="small"
        disabled={running || locked || atLimit}
        onClick={onRun}
        startIcon={<RefreshCw size={13} aria-hidden />}
        aria-label={running ? undefined : failed ? "Try the scan again. Costs 1 run." : `Refresh scan${usage ? `, ${usage.used} of ${usage.limit} runs used this month` : ""}. Costs 1 run.`}
        sx={{ borderRadius: 999, minHeight: { xs: 44, md: 36 }, fontSize: "0.75rem" }}
      >
        {running ? "Running…" : label}
      </Button>
    </Panel>
  );
}
