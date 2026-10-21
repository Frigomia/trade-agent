"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { WatchlistSummary } from "@/lib/api/portfolio-types";
import { useAction } from "@/lib/useAction";
import { priceToText, RANGE_ERROR, textsToRange } from "@/lib/priceRange";
import { fractionToPercentText, percentTextToFraction, TARGET_ERROR } from "@/lib/targetWeight";
import { TargetWeightField } from "@/components/portfolio/TargetWeightField";

interface Props {
  item: WatchlistSummary | null; // null = closed
  onClose: () => void;
  onSaved: () => void;
}

// The body is keyed by ticker so its text resets for each item.
export function WatchTargetDialog({ item, onClose, onSaved }: Props) {
  return (
    <Dialog open={item !== null} onClose={onClose} fullWidth maxWidth="xs">
      {item && <Body key={item.ticker} item={item} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function Body({ item, onClose, onSaved }: { item: WatchlistSummary; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(fractionToPercentText(item.target_weight));
  const [lowText, setLowText] = useState(priceToText(item.target_price_low));
  const [highText, setHighText] = useState(priceToText(item.target_price_high));
  const { run, submitting, error, setError } = useAction();
  const { mutate } = useSWRConfig();
  const [tried, setTried] = useState(false);
  // An untouched range is neither checked nor sent: what is saved stays as it is.
  const rangeEdited = lowText !== priceToText(item.target_price_low) || highText !== priceToText(item.target_price_high);
  const range = textsToRange(lowText, highText);
  // One end alone is not an error while the other is still being typed; it is, once saving was tried.
  const bothTyped = lowText.trim() !== "" && highText.trim() !== "";
  const rangeInvalid = rangeEdited && range === undefined && (tried || bothTyped);

  async function save() {
    const target = percentTextToFraction(text);
    if (target === undefined) {
      setError(TARGET_ERROR);
      return;
    }
    if (rangeEdited && range === undefined) {
      setTried(true);
      setError(RANGE_ERROR);
      return;
    }
    await run(async () => {
      // Blank sends an explicit null, which clears the saved target.
      await apiFetch("/portfolio/watchlist", {
        method: "POST",
        body: JSON.stringify({
          ticker: item.ticker,
          asset_type: item.asset_type,
          target_weight: target,
          // Both ends blank sends two explicit nulls, which clear the range.
          ...(rangeEdited && { target_price_low: range?.low ?? null, target_price_high: range?.high ?? null }),
        }),
      });
      void mutate("/portfolio/insights"); // Today's insights follow the new range
      onSaved();
      onClose();
    });
  }

  return (
    <>
      <DialogTitle>Target for {item.ticker}</DialogTitle>
      <DialogContent>
        <TargetWeightField value={text} onChange={setText} fullWidth margin="dense" />
        <Typography component="h3" sx={{ mt: 2, fontSize: "0.875rem", fontWeight: 650 }}>
          Target price range
        </Typography>
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          Today shows this company when its price enters the range. Leave both blank for none. Prices are in the
          quote&apos;s own unit; for London-listed shares that is pence.
        </Typography>
        <Box sx={{ display: "flex", gap: 1.5 }}>
          <TextField
            label="Lowest price"
            value={lowText}
            onChange={(e) => setLowText(e.target.value)}
            error={rangeInvalid}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            margin="dense"
            fullWidth
          />
          <TextField
            label="Highest price"
            value={highText}
            onChange={(e) => setHighText(e.target.value)}
            error={rangeInvalid}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            margin="dense"
            fullWidth
          />
        </Box>
        {rangeInvalid && (
          <Typography role="alert" sx={{ fontSize: "0.75rem", color: "error.main" }}>
            {RANGE_ERROR}
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={submitting} onClick={() => void save()}>
          Save target
        </Button>
      </DialogActions>
    </>
  );
}
