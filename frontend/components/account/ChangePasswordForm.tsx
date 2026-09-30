"use client";

import { useState, type FormEvent } from "react";
import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import { createClient } from "@/lib/supabase/client";
import { useAction } from "@/lib/useAction";

export const MIN_PASSWORD = 8;

export function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const { run, submitting, error, setError } = useAction();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    void run(async () => {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setPassword("");
      setConfirm("");
      setDone(true);
    });
  }

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 650 }}>
        Change password
      </Typography>
      <TextField
        label="New password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        slotProps={{ htmlInput: { autoComplete: "new-password" } }}
        fullWidth
        margin="normal"
      />
      <TextField
        label="Confirm new password"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        slotProps={{ htmlInput: { autoComplete: "new-password" } }}
        fullWidth
        margin="normal"
      />
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      {done && (
        <Typography variant="body2" role="status" sx={{ mt: 1 }}>
          Password changed.
        </Typography>
      )}
      <Button type="submit" variant="contained" sx={{ mt: 2 }} disabled={submitting}>
        Change password
      </Button>
    </Box>
  );
}
