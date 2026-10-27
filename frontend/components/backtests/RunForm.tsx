"use client";

import { useState, type FormEvent } from "react";
import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import { TickerPicker } from "@/components/ui/TickerPicker";
import type { SymbolMatch } from "@/lib/tickerSearch";
import { defaultRange, validateRun, type RunInput } from "@/lib/backtest";

export function RunForm({
  onRun,
  running,
  error,
  suggestions,
}: {
  onRun: (input: RunInput) => void;
  running: boolean;
  error: string | null;
  /** The user's own tickers, offered first in the ticker field. */
  suggestions?: SymbolMatch[];
}) {
  const [ticker, setTicker] = useState("");
  const [initial] = useState(() => defaultRange(new Date()));
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
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
      <TickerPicker label="Ticker" value={ticker} onChange={setTicker} suggestions={suggestions} />
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
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
      </Box>
      {shown && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {shown}
        </Alert>
      )}
      {running && (
        <Typography role="status" sx={{ display: "flex", alignItems: "center", gap: 1.25, mt: 1.5, fontSize: "0.8125rem", color: "var(--text2)" }}>
          <Box component="span" aria-hidden sx={{ display: "inline-flex", gap: "5px", "& i": { width: 6, height: 6, borderRadius: "50%", bgcolor: "var(--accent)" }, "& i:nth-of-type(2)": { opacity: 0.6 }, "& i:nth-of-type(3)": { opacity: 0.3 } }}>
            <i />
            <i />
            <i />
          </Box>
          Running the backtest. This can take a little while.
        </Typography>
      )}
      <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={running}>
        Run backtest
      </Button>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", mt: 1.5 }}>
        Starts with 10,000 and replays the technical signal on past prices.
      </Typography>
    </Box>
  );
}
