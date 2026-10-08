"use client";

import { useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { WatchlistSummary } from "@/lib/api/portfolio-types";
import { useAction } from "@/lib/useAction";
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
  const { run, submitting, error, setError } = useAction();

  async function save() {
    const target = percentTextToFraction(text);
    if (target === undefined) {
      setError(TARGET_ERROR);
      return;
    }
    await run(async () => {
      // Blank sends an explicit null, which clears the saved target.
      await apiFetch("/portfolio/watchlist", {
        method: "POST",
        body: JSON.stringify({ ticker: item.ticker, asset_type: item.asset_type, target_weight: target }),
      });
      onSaved();
      onClose();
    });
  }

  return (
    <>
      <DialogTitle>Target for {item.ticker}</DialogTitle>
      <DialogContent>
        <TargetWeightField value={text} onChange={setText} fullWidth margin="dense" />
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
