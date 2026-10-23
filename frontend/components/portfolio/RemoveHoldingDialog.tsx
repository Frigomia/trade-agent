"use client";

import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { HoldingSummary } from "@/lib/api/portfolio-types";
import { useAction } from "@/lib/useAction";

/**
 * Asks before removing a holding, and says what that does and does not do: it deletes the position
 * and its purchase details from the portfolio, and sells nothing (the app never places a trade).
 * `holding` stays set after `open` turns false, so the text does not go blank while the dialog fades
 * out. It cannot be dismissed while the request is running, so its outcome is always seen.
 */
export function RemoveHoldingDialog({
  holding,
  open,
  onClose,
  onRemoved,
}: {
  holding: HoldingSummary | null;
  open: boolean;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { run, submitting, error, setError } = useAction();
  const close = () => {
    if (submitting) return;
    setError(null);
    onClose();
  };
  const remove = () =>
    run(async () => {
      if (!holding) return;
      await apiFetch(`/portfolio/holdings/${encodeURIComponent(holding.ticker)}`, { method: "DELETE" });
      onRemoved();
      onClose();
    });
  return (
    <Dialog open={open && holding !== null} onClose={close} fullWidth maxWidth="xs">
      {holding && (
        <>
          <DialogTitle>Remove {holding.ticker}?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {holding.shares <= 0
                ? `This removes ${holding.name} from your closed positions, with its purchase details. It does not sell anything.`
                : `This removes ${holding.name} from your portfolio, with its shares and purchase details. It does not sell anything.`}
            </DialogContentText>
            {error && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {error}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button disabled={submitting} onClick={close}>
              Keep it
            </Button>
            <Button color="error" variant="contained" disabled={submitting} onClick={() => void remove()}>
              Remove holding
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
