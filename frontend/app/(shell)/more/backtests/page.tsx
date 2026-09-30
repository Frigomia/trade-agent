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

export default function BacktestsPage() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { run, submitting, error } = useAction();

  const { data: list, error: listError, mutate: mutateList } = useSWR<BacktestListItem[]>("/backtest/results", apiFetch);

  // Poll every 2s while RUNNING; SWR stops on DONE, FAILED or any error (a 404 means the job expired).
  const { data: job, error: jobError } = useSWR<JobStatus>(jobId ? `/backtest/run/${jobId}` : null, apiFetch, {
    refreshInterval: (latest) => (latest?.status === "RUNNING" ? 2000 : 0),
    onSuccess: (latest) => {
      if (latest.status === "DONE") mutateList();
    },
  });

  const resultId = selectedId ?? (job?.status === "DONE" ? job.backtest_result_id : null);
  const jobRunning = jobId !== null && !jobError && (job === undefined || job.status === "RUNNING");
  const jobFailed = job?.status === "FAILED" || jobError !== undefined;

  const { data: result, error: resultError } = useSWR<BacktestResult>(
    resultId !== null ? `/backtest/results/${resultId}` : null,
    apiFetch,
  );

  function start({ ticker, start: startDate, end }: RunInput) {
    run(async () => {
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
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 650 }}>
          Backtests
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Link href="/more">Back to More</Link>
      </Box>

      <RunForm onRun={start} running={submitting || jobRunning} error={error} />

      {jobFailed && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          The backtest could not run for that ticker and range. Check the ticker and dates.
        </Alert>
      )}
      {resultError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          Could not load that backtest.
        </Alert>
      )}
      {result && (
        <Box sx={{ mt: 2 }}>
          <BacktestResultPanel result={result} />
        </Box>
      )}

      <Typography component="h2" variant="h6" sx={{ mt: 3 }}>
        Recent runs
      </Typography>
      {listError && <Alert severity="error">Could not load your recent runs.</Alert>}
      {list && list.length === 0 && <Typography sx={{ color: "var(--text2)" }}>No backtests yet.</Typography>}
      {list && list.length > 0 && (
        <List>
          {list.map((item) => (
            <ListItemButton key={item.id} selected={item.id === resultId} onClick={() => setSelectedId(item.id)}>
              <ListItemText
                primary={item.ticker}
                secondary={`${item.start_date} to ${item.end_date}, ${excessLabel(item.excess_return_pct)}`}
              />
            </ListItemButton>
          ))}
        </List>
      )}
    </Box>
  );
}
