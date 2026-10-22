"use client";

import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from "@mui/material";
import { TargetWeightField } from "@/components/portfolio/TargetWeightField";
import { ApiError, apiFetch } from "@/lib/api/client";
import type { DiscoverItem } from "@/lib/api/discover-types";
import { nameOf } from "@/lib/discoverList";
import { priceToText, RANGE_ERROR, textsToRange } from "@/lib/priceRange";
import { fractionToPercentText, percentTextToFraction, TARGET_ERROR } from "@/lib/targetWeight";
import { useAction } from "@/lib/useAction";

interface Props {
  item: DiscoverItem | null; // null = closed
  onClose: () => void;
  /** After a save: the company as the backend now has it (without a quote). */
  onSaved: (updated: DiscoverItem) => void;
  /** The list is out of date (the company is gone, or is now owned): read it again. */
  onStale: () => void;
}

// The body is keyed by ticker so its text resets for each item.
export function TargetDialog({ item, onClose, onSaved, onStale }: Props) {
  return (
    <Dialog open={item !== null} onClose={onClose} fullWidth maxWidth="xs">
      {item && <Body key={item.ticker} item={item} onClose={onClose} onSaved={onSaved} onStale={onStale} />}
    </Dialog>
  );
}

/**
 * A saved company's weight target and price range. The prices are in the unit the card shows (pounds,
 * not pence): the backend converts. For a company that is owned the weight target lives on the holding,
 * so only the range is offered. Only what was edited is sent.
 */
function Body({ item, onClose, onSaved, onStale }: { item: DiscoverItem; onClose: () => void; onSaved: (updated: DiscoverItem) => void; onStale: () => void }) {
  const owned = item.owned;
  // The unit of a range is the card's currency: without it no range can be set. One already saved
  // can still be changed or cleared (the backend refuses a new value it cannot convert).
  const rangeLocked = item.currency === null && item.target_price_low === null;
  const [gone, setGone] = useState(false);
  // False once the dialog was left (Esc, Cancel): a save finishing later must not close the next one.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  // What the fields held when the dialog opened. "Edited" is measured against this, not against the
  // live list: a refresh of the same company (another tab, an earlier save) must not turn a field the
  // person never touched into part of the request.
  const [opened] = useState(() => ({
    weight: fractionToPercentText(item.target_weight),
    low: priceToText(item.target_price_low),
    high: priceToText(item.target_price_high),
  }));
  const [text, setText] = useState(opened.weight);
  const [lowText, setLowText] = useState(opened.low);
  const [highText, setHighText] = useState(opened.high);
  const { run, submitting, error, setError } = useAction();
  const { mutate } = useSWRConfig();
  const [tried, setTried] = useState(false);
  const weightEdited = !owned && text !== opened.weight;
  // An untouched range is neither checked nor sent: what is saved stays as it is.
  const rangeEdited = !rangeLocked && (lowText !== opened.low || highText !== opened.high);
  const range = textsToRange(lowText, highText);
  // One end alone is not an error while the other is still being typed; it is, once saving was tried.
  const bothTyped = lowText.trim() !== "" && highText.trim() !== "";
  const rangeInvalid = rangeEdited && range === undefined && (tried || bothTyped);
  const name = nameOf(item);

  async function save() {
    const target = weightEdited ? percentTextToFraction(text) : undefined;
    if (weightEdited && target === undefined) {
      setError(TARGET_ERROR);
      return;
    }
    if (rangeEdited && range === undefined) {
      setTried(true);
      setError(RANGE_ERROR);
      return;
    }
    if (!weightEdited && !rangeEdited) {
      onClose(); // nothing to save
      return;
    }
    await run(async () => {
      try {
        const updated = await apiFetch<DiscoverItem>(`/discover/${encodeURIComponent(item.ticker)}`, {
          method: "PATCH",
          body: JSON.stringify({
            // A blank field sends an explicit null, which clears what was saved.
            ...(weightEdited && { target_weight: target }),
            ...(rangeEdited && { target_price_low: range?.low ?? null, target_price_high: range?.high ?? null }),
          }),
        });
        if (rangeEdited) void mutate("/portfolio/insights"); // Today's insights follow the new range
        if (weightEdited) void mutate("/portfolio/summary"); // the holdings table falls back to this weight
        onSaved(updated);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setGone(true); // removed elsewhere: say so, and do not offer the same failing save again
          onStale();
        } else if (err instanceof ApiError && err.status === 409) {
          onStale(); // now owned: the list says so on its next read and the weight field goes
        }
        throw err;
      }
      if (open.current) onClose();
    });
  }

  return (
    <>
      <DialogTitle>{owned ? `Price range for ${name}` : `Target for ${name}`}</DialogTitle>
      <DialogContent>
        {!owned && <TargetWeightField value={text} onChange={setText} fullWidth margin="dense" />}
        {!owned && (
          <Typography component="h3" sx={{ mt: 2, fontSize: "0.875rem", fontWeight: 650 }}>
            Target price range
          </Typography>
        )}
        {owned && (
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", mb: 1 }}>
            You own this company, so its weight target is set on the holding in Portfolio.
          </Typography>
        )}
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          Today shows this company when its price enters the range. Leave both blank for none.{" "}
          {rangeLocked ? "Its currency is not known yet, so a range cannot be set until it is." : `Prices are in ${item.currency}, the same as the price on the card.`}
        </Typography>
        <Box sx={{ display: "flex", gap: 1.5 }}>
          <TextField
            label="Lowest price"
            disabled={rangeLocked}
            value={lowText}
            onChange={(e) => setLowText(e.target.value)}
            error={rangeInvalid}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            margin="dense"
            fullWidth
          />
          <TextField
            label="Highest price"
            disabled={rangeLocked}
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
        <Button variant="contained" disabled={submitting || gone} onClick={() => void save()} sx={{ minHeight: 44 }}>
          {owned ? "Save range" : "Save target"}
        </Button>
      </DialogActions>
    </>
  );
}
