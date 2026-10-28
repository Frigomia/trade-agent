"use client";

import { useState, type FormEvent } from "react";
import { Drawer, Box, Typography, TextField, Button, Alert } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import { useAction } from "@/lib/useAction";

interface InviteDrawerProps {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteDrawer({ open, onClose, onInvited }: InviteDrawerProps) {
  const [email, setEmail] = useState("");
  const { run, submitting, error } = useAction();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await apiFetch("/admin/users/invite", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setEmail("");
      onInvited();
      onClose();
    });
  }

  return (
    <Drawer anchor="right" open={open} onClose={submitting ? undefined : onClose} slotProps={{ paper: { "aria-busy": submitting } }}>
      <Box component="form" onSubmit={handleSubmit} sx={{ width: { xs: "100vw", sm: 360 }, maxWidth: "100%", p: 3 }}>
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em", mb: 2 }}>
          Invite user
        </Typography>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          fullWidth
          required
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
          Send invite
        </Button>
      </Box>
    </Drawer>
  );
}
