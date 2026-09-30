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
import { apiFetch, ApiError } from "@/lib/api/client";
import type { TradeAction } from "@/lib/api/portfolio-types";

export interface TradeSheetProps {
  open: boolean;
  onClose: () => void;
  holdings: { ticker: string; name: string }[];
  prefill?: { ticker?: string; action?: TradeAction };
  onLogged: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

// A bottom sheet on phones, a right drawer on desktop. The form lives in an inner component so its
// state resets every time the drawer closes (MUI unmounts a closed drawer's children).
export function TradeSheet({ open, onClose, holdings, prefill, onLogged }: TradeSheetProps) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down("md"));
  return (
    <Drawer anchor={isPhone ? "bottom" : "right"} open={open} onClose={onClose}>
      <TradeForm holdings={holdings} prefill={prefill} onClose={onClose} onLogged={onLogged} />
    </Drawer>
  );
}

function TradeForm({
  holdings,
  prefill,
  onClose,
  onLogged,
}: Pick<TradeSheetProps, "holdings" | "prefill" | "onClose" | "onLogged">) {
  const [ticker, setTicker] = useState(prefill?.ticker ?? holdings[0]?.ticker ?? "");
  const [action, setAction] = useState<TradeAction>(prefill?.action ?? "BUY");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const sharesNum = Number(shares);
    const priceNum = Number(price);
    if (!ticker || !(sharesNum > 0) || !(priceNum > 0)) {
      setError("Choose a ticker and enter shares and a price above zero.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/portfolio/trades", {
        method: "POST",
        body: JSON.stringify({ date, ticker, action, shares: sharesNum, price: priceNum }),
      });
      onLogged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{ width: { xs: "auto", md: 400 }, p: 3, pb: { xs: 4, md: 3 } }}
    >
      <Typography variant="h6" sx={{ fontWeight: 650 }}>
        Log a trade
      </Typography>
      <Typography sx={{ color: "var(--muted)", fontSize: 13, mt: 0.5 }}>
        Record a trade you already placed in your broker app.
      </Typography>
      <Alert severity="info" sx={{ mt: 1.5 }}>
        This only records it here. Nothing is sent to a broker.
      </Alert>
      <TextField
        select
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        label="Ticker"
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
      <ToggleButtonGroup
        exclusive
        fullWidth
        value={action}
        onChange={(_, next: TradeAction | null) => next && setAction(next)}
        sx={{ mt: 1 }}
      >
        <ToggleButton value="BUY">Bought</ToggleButton>
        <ToggleButton value="SELL">Sold</ToggleButton>
      </ToggleButtonGroup>
      <Box sx={{ display: "flex", gap: 1.5 }}>
        <TextField
          label="Shares"
          type="number"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Price"
          type="number"
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
