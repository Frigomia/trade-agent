"use client";

import { useState, type FormEvent } from "react";
import { Drawer, Box, Typography, TextField, Button, Alert } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";

interface InviteDrawerProps {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteDrawer({ open, onClose, onInvited }: InviteDrawerProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/admin/users/invite", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setEmail("");
      onInvited();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box component="form" onSubmit={handleSubmit} sx={{ width: 360, p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 650, mb: 2 }}>
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
