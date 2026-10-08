"use client";

import { Alert, Snackbar } from "@mui/material";

/** A non-blocking note (role="alert") that outlives the form it came from. */
export function IsinNote({ note, onClose }: { note: string | null; onClose: () => void }) {
  return (
    <Snackbar open={note !== null} autoHideDuration={12000} onClose={onClose} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
      <Alert severity="info" role="alert" onClose={onClose}>
        {note}
      </Alert>
    </Snackbar>
  );
}
