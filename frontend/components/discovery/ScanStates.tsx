import type { ReactNode } from "react";
import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { Check, KeyRound, RefreshCw, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { DiscoveryJob, ScanRun } from "@/lib/api/discovery-types";
import { KEY_REJECTED_MESSAGE, SCAN_STAGES, stageIndex } from "@/lib/discovery";

const TITLE = { fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.25 } as const;
const BODY = { fontSize: "0.8125rem", color: "var(--text2)", lineHeight: 1.5, maxWidth: "46ch" } as const;

/** One state of the scan section: a 22px panel with a title and short text, left aligned. */
function State({ title, children, tile }: { title: string; children?: ReactNode; tile?: ReactNode }) {
  return (
    <Panel sx={{ p: "22px", display: "grid", justifyItems: "start", gap: 0.5 }}>
      {tile}
      <Typography component="h3" sx={{ ...TITLE, mt: tile ? 1.5 : 0 }}>
        {title}
      </Typography>
      {children}
    </Panel>
  );
}

/** The 42px caution tile that leads a failed state: an icon on the amber wash, never red. */
function Tone({ icon: Icon }: { icon: typeof TriangleAlert }) {
  return (
    <Box
      aria-hidden
      sx={{ width: 42, height: 42, borderRadius: "14px", display: "grid", placeItems: "center", bgcolor: "var(--warn-bg)", color: "var(--warn)" }}
    >
      <Icon size={18} />
    </Box>
  );
}

/**
 * A scan is running: a progress bar over the five stages the backend reports, each marked done,
 * current or waiting by an icon and its text, with the researching count on the current one.
 */
export function ScanRunning({ job, universe }: { job: DiscoveryJob | undefined; universe?: number }) {
  const current = stageIndex(job?.stage);
  const total = job?.total ?? 0;
  const done = job?.done ?? 0;
  // The bar fills one fifth per stage; inside the researching stage it also follows the candidates.
  const inStage = SCAN_STAGES[current].key === "researching" && total > 0 ? done / total : 0;
  const percent = Math.round(((current + inStage) / SCAN_STAGES.length) * 100);
  // The size of the list is known from the previous scan; the first one just says "companies".
  const labelOf = (key: string, label: string) => (key === "screening" && universe ? `Screening ${universe} companies` : label);
  return (
    <State title="Scanning the market">
      <Box
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        sx={{ width: "100%", height: 6, borderRadius: 999, bgcolor: "var(--track)", overflow: "hidden", mt: 1.5 }}
      >
        <Box sx={{ height: "100%", width: `${percent}%`, bgcolor: "var(--accent)", borderRadius: 999, transition: "width 0.4s ease-out" }} />
      </Box>
      <Box component="ol" sx={{ listStyle: "none", m: 0, mt: 2, p: 0, display: "grid", gap: 1.25, width: "100%" }}>
        {SCAN_STAGES.map((stage, n) => {
          const state = n < current ? "done" : n === current ? "current" : "waiting";
          return (
            <Box
              component="li"
              key={stage.key}
              aria-current={state === "current" ? "step" : undefined}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                fontSize: "0.8125rem",
                color: state === "current" ? "var(--text)" : state === "done" ? "var(--text2)" : "var(--muted)",
                fontWeight: state === "current" ? 500 : 400,
              }}
            >
              <Box
                aria-hidden
                component="span"
                sx={{
                  width: 18,
                  height: 18,
                  flex: "none",
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  border: "1.5px solid",
                  borderColor: state === "done" ? "var(--text2)" : state === "current" ? "var(--accent)" : "var(--line2)",
                  bgcolor: state === "done" ? "var(--text2)" : "transparent",
                  color: "var(--bg)",
                  boxShadow: state === "current" ? "0 0 0 3px var(--accent-wash)" : "none",
                }}
              >
                {state === "done" && <Check size={11} strokeWidth={3} />}
              </Box>
              {state === "current" && stage.key === "researching" && total > 0 ? `${stage.label} · ${done} of ${total}` : labelOf(stage.key, stage.label)}
            </Box>
          );
        })}
      </Box>
      <Typography sx={{ mt: 1.5, fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.5 }}>
        The scan keeps running if you leave this page.
      </Typography>
    </State>
  );
}

/**
 * The scan finished and no company reached the bar. A result, not an error: a muted zero, the
 * reason in words, and the nearest misses as chips with their scores.
 */
export function NoOpportunity({ scan }: { scan: ScanRun }) {
  const misses = scan.coverage_summary.nearest_misses ?? [];
  return (
    <State title="No compelling opportunity today" tile={<Box component="span" aria-hidden sx={{ fontSize: "1.625rem", fontWeight: 650, color: "var(--muted)", lineHeight: 1 }}>0</Box>}>
      <Typography sx={BODY}>No company reached the score and confidence bar. That is a result, not an error.</Typography>
      {misses.length > 0 && (
        <Box component="ul" aria-label="Nearest misses" sx={{ listStyle: "none", m: 0, mt: 1.5, p: 0, display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Chip>Nearest misses</Chip>
          {misses.map((miss) => (
            <Chip key={miss.ticker}>
              {miss.name && <b>{miss.name}</b>}
              {miss.name ? " " : ""}
              {miss.ticker} · {miss.overall ?? "no score"} · {miss.confidence} confidence
            </Chip>
          ))}
        </Box>
      )}
    </State>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <Box
      component="li"
      sx={{ px: 1.5, py: 0.5, minHeight: 28, display: "inline-flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", borderRadius: 14, bgcolor: "var(--track)", color: "var(--text2)", fontSize: "0.75rem", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}
    >
      {children}
    </Box>
  );
}

/** No scan has ever run for this account. */
export function FirstScan() {
  return (
    <State title="Run your first scan">
      <Typography sx={BODY}>
        A scan researches companies from a global list and keeps the few worth a look, each with its reasoning and its risks. It uses one of your monthly runs.
      </Typography>
    </State>
  );
}

/**
 * The last scan failed and nothing was saved; the previous ideas are still below. A rejected
 * Claude key gets its own wording and a way to fix it; anything else offers to try again.
 */
export function ScanFailed({ message, locked, exhausted, onRetry }: { message: string | null; locked: boolean; exhausted: boolean; onRetry: () => void }) {
  if (message === KEY_REJECTED_MESSAGE) {
    return (
      <State title={KEY_REJECTED_MESSAGE} tile={<Tone icon={KeyRound} />}>
        <Typography sx={BODY}>Claude did not accept your key, so the scan stopped. Nothing was saved.</Typography>
        <Button
          component={Link}
          href="/more/connect-claude?step=5"
          variant="contained"
          startIcon={<KeyRound size={15} aria-hidden />}
          sx={{ mt: 1.75, minHeight: 44 }}
        >
          Reconnect Claude
        </Button>
      </State>
    );
  }
  return (
    <State title="The scan did not finish" tile={<Tone icon={TriangleAlert} />}>
      <Typography sx={BODY}>{(message ?? "Something went wrong").replace(/[.!?\s]*$/, ".")} Nothing was saved.</Typography>
      <Button variant="contained" disabled={locked || exhausted} onClick={onRetry} startIcon={<RefreshCw size={15} aria-hidden />} sx={{ mt: 1.75, minHeight: 44 }}>
        Try again
      </Button>
      {exhausted && <Typography sx={{ ...BODY, color: "var(--muted)" }}>You have used all your scan runs for this month.</Typography>}
    </State>
  );
}
