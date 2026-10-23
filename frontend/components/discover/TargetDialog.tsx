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

// The body is keyed by ticker so its text resets for each item. The last item stays in the body while
// the dialog fades out, so it does not blank first; and a company found to be gone keeps the dialog open
// with its message, even though the refreshed list no longer has it, until the person closes it.
export function TargetDialog({ item, onClose, onSaved, onStale }: Props) {
  const [kept, setKept] = useState(item);
  if (item !== null && item !== kept) setKept(item);
  const [gone, setGone] = useState(false);
  const active = item !== null || gone;
  // Each time the dialog opens is a new session, so reopening the same company while the last one is
  // still fading out starts with a fresh form.
  const [session, setSession] = useState(0);
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setSession(session + 1);
  }
  const close = () => {
    setGone(false);
    onClose();
  };
  return (
    <Dialog open={active} onClose={close} fullWidth maxWidth="xs">
      {kept && (
        <Body key={`${kept.ticker}:${session}`} item={kept} active={active} onClose={close} onSaved={onSaved} onStale={onStale} onGone={() => setGone(true)} />
      )}
    </Dialog>
  );
}

/**
 * A saved company's weight target and price range. The prices are in the unit the card shows (pounds,
 * not pence): the backend converts. For a company that is owned the weight target lives on the holding,
 * so only the range is offered. Only what was edited is sent.
 */
function Body({ item, active, onClose, onSaved, onStale, onGone }: { item: DiscoverItem; active: boolean; onClose: () => void; onSaved: (updated: DiscoverItem) => void; onStale: () => void; onGone: () => void }) {
  const owned = item.owned;
  // The unit of a range is the card's currency: without it no range can be set. One already saved
  // can still be changed or cleared (the backend refuses a new value it cannot convert).
  const rangeLocked = item.currency === null && item.target_price_low === null;
  const [gone, setGone] = useState(false);
  // False once the dialog was left (Esc, Cancel): a save finishing later must not close the next one.
  const open = useRef(true);
  useEffect(() => {
    open.current = active;
  }, [active]);
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
  // The list read again while this was open (another tab, an earlier save): untouched fields keep what
  // they held when it opened, so the person is told rather than left to wonder.
  const changedMeanwhile =
    active &&
    !submitting &&
    (fractionToPercentText(item.target_weight) !== opened.weight ||
      priceToText(item.target_price_low) !== opened.low ||
      priceToText(item.target_price_high) !== opened.high);

  async function save() {
    const target = weightEdited ? percentTextToFraction(text) : undefined;
    const weightBad = weightEdited && target === undefined;
    const rangeBad = rangeEdited && range === undefined;
    // Both problems are shown at once: the weight in the alert, the range under its fields.
    if (weightBad || rangeBad) {
      if (rangeBad) setTried(true);
      setError(weightBad ? TARGET_ERROR : null);
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
          if (open.current) onGone(); // and keep this open: the list is about to stop having the company (not if it was left)
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
        {changedMeanwhile && (
          <Typography role="status" sx={{ fontSize: "0.75rem", color: "var(--text2)", mt: 1 }}>
            This company changed elsewhere while you were editing. Fields you have not touched still show what you opened. Close this to see the current values.
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
