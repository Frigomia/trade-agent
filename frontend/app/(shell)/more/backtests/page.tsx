"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Alert, Box, List, ListItemButton, ListItemText, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import { excessLabel } from "@/lib/backtest";
import type { BacktestListItem, BacktestResult, JobStatus, RunInput } from "@/lib/backtest";
import { useAction } from "@/lib/useAction";
import { RunForm } from "@/components/backtests/RunForm";
import { BacktestResultPanel } from "@/components/backtests/BacktestResultPanel";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { formatPct } from "@/lib/format";
import { PageHeader } from "@/components/shell/PageHeader";

export default function BacktestsPage() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { run, submitting, error } = useAction();

  const { data: list, error: listError, mutate: mutateList } = useSWR<BacktestListItem[]>("/backtest/results", apiFetch);

  // Poll every 2s while RUNNING; SWR stops on DONE, FAILED or any error (a 404 means the job expired).
  const { data: job, error: jobError } = useSWR<JobStatus>(jobId ? `/backtest/run/${jobId}` : null, apiFetch, {
    refreshInterval: (latest) => (latest?.status === "RUNNING" ? 2000 : 0),
    // The key only needs the interval: no error retry (an expired job would 404 forever) and no
    // focus/reconnect revalidation (a finished job's TTL can lapse and 404 next to a good result).
    shouldRetryOnError: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    onSuccess: (latest) => {
      if (latest.status === "DONE") mutateList();
    },
  });

  const resultId = selectedId ?? (job?.status === "DONE" ? job.backtest_result_id : null);
  const jobRunning = jobId !== null && !jobError && (job === undefined || job.status === "RUNNING");
  // A later fetch error next to DONE data is not a failure: the run already finished.
  const jobFailed = job?.status === "FAILED" || (jobError !== undefined && job?.status !== "DONE");

  const { data: result, error: resultError } = useSWR<BacktestResult>(
    resultId !== null ? `/backtest/results/${resultId}` : null,
    apiFetch,
  );

  function start({ ticker, start: startDate, end }: RunInput) {
    run(async () => {
      // Pin a shown result so clearing the job keeps it visible if the POST fails.
      if (resultId !== null) setSelectedId(resultId);
      setJobId(null); // clear any old failure warning while this request is in flight
      const { job_id } = await apiFetch<{ job_id: string }>("/backtest/run", {
        method: "POST",
        body: JSON.stringify({ ticker, start_date: startDate, end_date: end }),
      });
      setSelectedId(null);
      setJobId(job_id);
    });
  }

  return (
    <Box>
      <PageHeader title="Backtests" actions={<Link href="/more">Back to More</Link>} />

      <Box
        sx={{
          display: "grid",
          gap: 2,
          alignItems: "start",
          gridTemplateColumns: { md: "minmax(0, 340px) minmax(0, 1fr)" },
          gridTemplateAreas: {
            xs: '"form" "result" "runs"',
            md: '"form result" "runs result"',
          },
        }}
      >
        <Panel sx={{ gridArea: "form", p: "16px 18px" }}>
          <Typography component="h2" sx={{ fontSize: 17, fontWeight: 650, mb: 0.5 }}>
            Run a backtest
          </Typography>
          <RunForm onRun={start} running={submitting || jobRunning} error={error} />
        </Panel>

        <Box sx={{ gridArea: "result", minWidth: 0 }}>
          {jobFailed && selectedId === null && (
            <Alert severity="warning">
              The backtest could not run for that ticker and range. Check the ticker and dates.
            </Alert>
          )}
          {resultError && <Alert severity="error">Could not load that backtest.</Alert>}
          {result && <BacktestResultPanel result={result} />}
        </Box>

        <Panel sx={{ gridArea: "runs", p: "14px 10px" }}>
          <Typography component="h2" sx={{ fontSize: 15, fontWeight: 650, px: 1.5 }}>
            Recent runs
          </Typography>
          {listError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              Could not load your recent runs.
            </Alert>
          )}
          {list && list.length === 0 && (
            <Typography sx={{ color: "var(--text2)", px: 1.5, mt: 1 }}>No backtests yet.</Typography>
          )}
          {list && list.length > 0 && (
            <List>
              {list.map((item) => (
                <ListItemButton key={item.id} selected={item.id === resultId} onClick={() => setSelectedId(item.id)}>
                  <ListItemText
                    primary={item.ticker}
                    secondary={`${item.start_date} to ${item.end_date}`}
                    slotProps={{ primary: { sx: { fontWeight: 650 } } }}
                  />
                  <Pill tone={item.excess_return_pct < 0 ? "down" : "up"}>
                    <span title={excessLabel(item.excess_return_pct)}>{formatPct(item.excess_return_pct * 100)}</span>
                  </Pill>
                </ListItemButton>
              ))}
            </List>
          )}
        </Panel>
      </Box>
    </Box>
  );
}
