"use client";

import { useState, type FormEvent } from "react";
import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import { defaultRange, validateRun, type RunInput } from "@/lib/backtest";

export function RunForm({
  onRun,
  running,
  error,
}: {
  onRun: (input: RunInput) => void;
  running: boolean;
  error: string | null;
}) {
  const [ticker, setTicker] = useState("");
  const [start, setStart] = useState(() => defaultRange(new Date()).start);
  const [end, setEnd] = useState(() => defaultRange(new Date()).end);
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validateRun({ ticker, start, end });
    setMessage(problem);
    if (problem) return;
    onRun({ ticker: ticker.trim().toUpperCase(), start, end });
  }

  const shown = message ?? error;

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <TextField
        label="Ticker"
        value={ticker}
        onChange={(e) => setTicker(e.target.value)}
        slotProps={{ htmlInput: { autoComplete: "off" } }}
        fullWidth
        margin="normal"
      />
      <TextField
        label="From"
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        fullWidth
        margin="normal"
      />
      <TextField
        label="To"
        type="date"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        fullWidth
        margin="normal"
      />
      {shown && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {shown}
        </Alert>
      )}
      {running && (
        <Typography variant="body2" role="status" sx={{ mt: 1 }}>
          Running the backtest. This can take a little while.
        </Typography>
      )}
      <Button type="submit" variant="contained" sx={{ mt: 2 }} disabled={running}>
        Run backtest
      </Button>
    </Box>
  );
}
