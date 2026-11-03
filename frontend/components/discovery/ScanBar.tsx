import { Fragment } from "react";
import NextLink from "next/link";
import { Box, Button } from "@mui/material";
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

// The one-line separator of a wide bar. On a phone each part sits on its own line, so it is only
// hidden from the eye: a screen reader still hears the pause.
// (MUI's `width: 1` means 100%, so the 1px box is spelled out.)
const hiddenOnPhone = { position: { xs: "absolute", md: "static" }, width: { xs: "1px", md: "auto" }, height: { xs: "1px", md: "auto" }, m: { xs: "-1px", md: 0 }, overflow: { xs: "hidden", md: "visible" }, clipPath: { xs: "inset(50%)", md: "none" }, whiteSpace: "nowrap" } as const;
const Dot = () => (
  <Box component="span" sx={hiddenOnPhone}>
    {" · "}
  </Box>
);
// A part of the summary: its own line on a phone, inline from md.
const part = { display: { xs: "block", md: "inline" }, overflowWrap: "break-word" } as const;

/**
 * The latest scan: what it is and when it ran, then the actions. On a phone the actions have their own
 * row under the text, so neither can squeeze the other; from md it is one line.
 */
export function ScanBar({ scan, job, running, usage, locked, now, onRun }: Props) {
  const failed = !running && job?.status === "FAILED";
  let text: React.ReactNode;
  if (running) {
    text = (
      <>
        <b>Scanning now</b>
        <Dot />
        <Box component="span" sx={part}>
          researching {job?.done ?? 0} of {job?.total ?? 0}
        </Box>
      </>
    );
  } else if (failed) {
    text = <b>Last scan did not finish</b>;
  } else if (scan) {
    const counts = scanCounts(scan);
    text = (
      <>
        <b>Latest AI scan</b>
        <Dot />
        <Box component="span" sx={{ ...part, color: "var(--muted)" }}>
          Updated {whenText(scan.created_at, now)}
        </Box>
        {counts.length > 0 && (
          <>
            <Dot />
            <Box component="span" sx={part}>
              {counts.map((c, i) => (
                <Fragment key={c}>
                  {i > 0 && " · "}
                  <Box component="span" sx={{ whiteSpace: "nowrap" }}>
                    {c}
                  </Box>
                </Fragment>
              ))}
            </Box>
          </>
        )}
      </>
    );
  } else {
    text = <b>No scan yet</b>;
  }
  const atLimit = runsExhausted(usage);
  const label = failed ? "Try again" : usage ? `${usage.used} of ${usage.limit} runs` : "Run scan";
  const button = { borderRadius: 999, minHeight: { xs: 44, md: 36 }, minWidth: 0, px: { xs: 1.5, md: 2 }, fontSize: "0.75rem", whiteSpace: "nowrap" } as const;
  return (
    <Panel
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "auto minmax(0, 1fr)", md: "auto minmax(0, 1fr) auto" },
        alignItems: "center",
        columnGap: 1.5,
        rowGap: 1.5,
        p: { xs: "14px 16px", md: "10px 14px" },
      }}
    >
      <Box
        aria-hidden
        sx={{ width: 34, height: 34, borderRadius: "12px", display: "grid", placeItems: "center", bgcolor: "var(--accent-wash)", color: "var(--accent)" }}
      >
        <Sparkles size={15} />
      </Box>
      <Box role="status" sx={{ minWidth: 0, fontSize: "0.8125rem", lineHeight: 1.45, color: "var(--text2)", "& b": { color: "var(--text)" } }}>
        {text}
      </Box>
      {/* The last saved scan is readable while a new one runs or after one failed. */}
      <Box
        sx={{
          gridColumn: { xs: "1 / -1", md: "auto" },
          display: "grid",
          gridTemplateColumns: { xs: scan ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)", sm: "repeat(2, max-content)" },
          gap: 1,
        }}
      >
        {scan && (
          <Button
            component={NextLink}
            href="/today/scan"
            variant="outlined"
            size="small"
            endIcon={<ChevronRight size={13} aria-hidden />}
            sx={button}
          >
            Scan results
          </Button>
        )}
        <Button
          variant="outlined"
          size="small"
          disabled={running || locked || atLimit}
          onClick={onRun}
          startIcon={<RefreshCw size={13} aria-hidden />}
          aria-label={running ? undefined : failed ? "Try the scan again. Costs 1 run." : `Refresh scan${usage ? `, ${usage.used} of ${usage.limit} runs used this month` : ""}. Costs 1 run.`}
          sx={button}
        >
          {running ? "Running…" : label}
        </Button>
      </Box>
    </Panel>
  );
}
