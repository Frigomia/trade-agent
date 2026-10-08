"use client";

import { Alert, Snackbar } from "@mui/material";

/** A polite, non-blocking note (role="status") that outlives the form it came from. */
export function IsinNote({ note, onClose }: { note: string | null; onClose: () => void }) {
  return (
    <Snackbar open={note !== null} autoHideDuration={8000} onClose={onClose} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
      <Alert severity="info" role="status" onClose={onClose}>
        {note}
      </Alert>
    </Snackbar>
  );
}
