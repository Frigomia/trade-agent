// frontend/components/portfolio/TradeSheet.tsx
"use client";

import { useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Drawer,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { TradeAction } from "@/lib/api/portfolio-types";
import { todayIso } from "@/lib/format";
import { useAction } from "@/lib/useAction";

export interface TradeSheetProps {
  open: boolean;
  onClose: () => void;
  holdings: { ticker: string; name: string }[];
  prefill?: { ticker?: string; action?: TradeAction };
  onLogged: () => void;
  recurringOccurrence?: { id: number; currency: string };
}

// A bottom sheet on phones, a right drawer on desktop. The form lives in an inner component so its
// state resets every time the drawer closes (MUI unmounts a closed drawer's children).
export function TradeSheet({ open, onClose, holdings, prefill, onLogged, recurringOccurrence }: TradeSheetProps) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down("md"));
  // A trade being logged cannot be dismissed: the form would unmount with no error display.
  const [busy, setBusy] = useState(false);
  return (
    <Drawer anchor={isPhone ? "bottom" : "right"} open={open} onClose={busy ? undefined : onClose} slotProps={{ paper: { "aria-busy": busy } }}>
      <TradeForm holdings={holdings} prefill={prefill} onClose={onClose} onLogged={onLogged} onBusyChange={setBusy} recurringOccurrence={recurringOccurrence} />
    </Drawer>
  );
}

function TradeForm({
  holdings,
  prefill,
  onClose,
  onLogged,
  onBusyChange,
  recurringOccurrence,
}: Pick<TradeSheetProps, "holdings" | "prefill" | "onClose" | "onLogged" | "recurringOccurrence"> & { onBusyChange: (busy: boolean) => void }) {
  const [ticker, setTicker] = useState(prefill?.ticker ?? holdings[0]?.ticker ?? "");
  const [action, setAction] = useState<TradeAction>(prefill?.action ?? "BUY");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayIso);
  const { run, submitting, error, setError } = useAction(onBusyChange);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const sharesNum = Number(shares);
    const priceNum = Number(price);
    if (!ticker || !(sharesNum > 0) || !(priceNum > 0)) {
      setError("Choose a ticker and enter shares and a price above zero.");
      return;
    }
    await run(async () => {
      await apiFetch(recurringOccurrence ? `/portfolio/recurring/occurrences/${recurringOccurrence.id}/confirm` : "/portfolio/trades", {
        method: "POST",
        body: JSON.stringify(recurringOccurrence
          ? { date, shares: sharesNum, price: priceNum }
          : { date, ticker, action, shares: sharesNum, price: priceNum }),
      });
      onLogged();
      onClose();
    });
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{ width: { xs: "auto", md: 400 }, p: 3, pb: { xs: 4, md: 3 } }}
    >
      <Typography variant="h6" sx={{ fontWeight: 650 }}>
        {recurringOccurrence ? "Confirm external purchase" : "Log a trade"}
      </Typography>
      <Typography sx={{ color: "var(--muted)", fontSize: "0.8125rem", mt: 0.5 }}>
        Record a trade you already placed in your broker app.
      </Typography>
      <Alert severity="info" sx={{ mt: 1.5 }}>
        This only records it here. Nothing is sent to a broker.
      </Alert>
      <TextField
        select
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        label="Ticker"
        disabled={!!recurringOccurrence}
        value={ticker}
        onChange={(e) => setTicker(e.target.value)}
        fullWidth
        margin="normal"
      >
        {holdings.map((h) => (
          <option key={h.ticker} value={h.ticker}>
            {h.ticker} · {h.name}
          </option>
        ))}
      </TextField>
      {!recurringOccurrence && <ToggleButtonGroup
        exclusive
        fullWidth
        value={action}
        onChange={(_, next: TradeAction | null) => next && setAction(next)}
        sx={{ mt: 1 }}
      >
        <ToggleButton value="BUY">Bought</ToggleButton>
        <ToggleButton value="SELL">Sold</ToggleButton>
      </ToggleButtonGroup>}
      {recurringOccurrence && <Typography sx={{ mt: 1.5, color: "var(--muted)" }}>
        Enter actual shares, price and date from your provider. The expected amount is in {recurringOccurrence.currency};
        use the instrument&apos;s quote unit for the price, as on Holdings. Fees are not supported in the trade log.
      </Typography>}
      <Box sx={{ display: "flex", gap: 1.5 }}>
        <TextField
          label="Shares"
          type="number"
          slotProps={{ htmlInput: { step: "any", min: 0.000001 } }}
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Price"
          type="number"
          slotProps={{ htmlInput: { step: "any", min: 0.000001 } }}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          fullWidth
          margin="normal"
        />
      </Box>
      <TextField
        label="Date"
        type="date"
        slotProps={{ inputLabel: { shrink: true } }}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        fullWidth
        margin="normal"
      />
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
        Save to log
      </Button>
    </Box>
  );
}
