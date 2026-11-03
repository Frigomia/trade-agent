import NextLink from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { ChevronRight, RefreshCw, Sparkles } from "lucide-react";
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

/** Research scan status and actions, stacked so neither can squeeze the other on mobile. */
export function ScanBar({ scan, job, running, usage, locked, now, onRun }: Props) {
  const failed = !running && job?.status === "FAILED";
  const atLimit = runsExhausted(usage);
  const label = failed ? "Try again" : usage ? `${usage.used} of ${usage.limit} runs` : scan ? "Refresh scan" : "Run scan";
  const title = running ? "Scanning now" : failed ? "Last scan did not finish" : scan ? "Latest AI scan" : "No scan yet";
  const details = running
    ? `Researching ${job?.done ?? 0} of ${job?.total ?? 0}`
    : scan
      ? `Updated ${whenText(scan.created_at, now)}`
      : null;

  return (
    <Panel sx={{ display: "grid", gap: 2, p: { xs: 2, md: 2.5 } }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, minWidth: 0 }}>
        <Box
          aria-hidden
          sx={{
            width: 40, height: 40, borderRadius: "12px", display: "grid", placeItems: "center",
            bgcolor: "var(--accent-wash)", color: "var(--accent)", flex: "none",
          }}
        >
          <Sparkles size={18} />
        </Box>
        <Box role="status" sx={{ minWidth: 0, flex: 1 }}>
          <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, lineHeight: 1.4 }}>
            {title}
          </Typography>
          {details && (
            <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)", mt: 0.25, overflowWrap: "anywhere" }}>
              {details}
            </Typography>
          )}
          {scan && (
            <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)", mt: 0.75 }}>
              {scanCounts(scan).join(" · ")}
            </Typography>
          )}
        </Box>
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25, minWidth: 0 }}>
        {scan && (
          <Button
            component={NextLink}
            href="/today/scan"
            variant="contained"
            endIcon={<ChevronRight size={16} aria-hidden />}
            sx={{ minHeight: 44, borderRadius: "14px", flex: { xs: "1 1 100%", sm: "0 1 auto" } }}
          >
            View scan results
          </Button>
        )}
        <Button
          variant="outlined"
          disabled={running || locked || atLimit}
          onClick={onRun}
          startIcon={<RefreshCw size={15} aria-hidden />}
          aria-label={running ? undefined : failed ? "Try the scan again. Costs 1 run." : `${scan ? "Refresh" : "Run"} scan${usage ? `, ${usage.used} of ${usage.limit} runs used this month` : ""}. Costs 1 run.`
          sx={{
            minHeight: 44, minWidth: 0, borderRadius: "14px", px: 2,
            flex: { xs: "1 1 100%", sm: "0 1 auto" }, color: "var(--text2)",
            borderColor: "var(--line2)",
          }}
        >
          {running ? "Running…" : label}
        </Button>
      </Box>
    </Panel>
  );
}