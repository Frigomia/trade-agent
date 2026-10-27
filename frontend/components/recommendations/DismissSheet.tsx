"use client";

import { useId, useState } from "react";
import { Alert, Box, Button, Drawer, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { useDecision } from "@/lib/useDecision";

export function DismissSheet({ id, onClose, onDecided }: {
  id: number;
  onClose: () => void;
  onDecided: (updated: RecommendationOut) => void;
}) {
  const titleId = useId();
  const [reason, setReason] = useState("");
  const isPhone = useMediaQuery(useTheme().breakpoints.down("md"));
  const { decide, submitting, error } = useDecision(id, (updated) => {
    onClose();
    onDecided(updated);
  });

  return (
    <Drawer open anchor={isPhone ? "bottom" : "right"} onClose={submitting ? undefined : onClose}
      slotProps={{ paper: { role: "dialog", "aria-modal": true, "aria-labelledby": titleId, "aria-busy": submitting } }}>
      <Box component="form" onSubmit={(event) => { event.preventDefault(); void decide("reject", reason); }}
        sx={{ p: 3, width: { xs: "100%", md: 400 }, maxWidth: "100vw", display: "grid", gap: 2 }}>
        <Typography id={titleId} component="h2" sx={{ fontSize: "1.375rem", fontWeight: 650 }}>Dismiss this idea?</Typography>
        <Typography sx={{ color: "var(--text2)" }}>Your reason is only a private note. It does not feed chat memory or analysis.</Typography>
        <TextField label="Reason (optional)" value={reason} onChange={(event) => setReason(event.target.value)}
          disabled={submitting} autoFocus fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} helperText={`${reason.length}/500`} />
        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" variant="contained" disabled={submitting} sx={{ minHeight: 44 }}>Dismiss idea</Button>
        <Button disabled={submitting} onClick={() => decide("reject")} sx={{ minHeight: 44 }}>Skip reason and dismiss</Button>
        <Button disabled={submitting} onClick={onClose} sx={{ minHeight: 44 }}>Cancel</Button>
      </Box>
    </Drawer>
  );
}
