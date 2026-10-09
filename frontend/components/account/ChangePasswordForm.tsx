"use client";

import { useState, type FormEvent } from "react";
import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import { createClient } from "@/lib/supabase/client";
import { useAction } from "@/lib/useAction";

export const MIN_PASSWORD = 8;

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const { run, submitting, error, setError } = useAction();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    if (!current) {
      setError("Enter your current password.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    void run(async () => {
      // A stolen session alone must not be enough to change the password: prove the current one.
      const { auth } = createClient();
      const { data } = await auth.getUser();
      const email = data?.user?.email;
      if (!email) {
        setError("Could not confirm your account. Sign in again.");
        return;
      }
      const { error: currentError } = await auth.signInWithPassword({ email, password: current });
      if (currentError) {
        setError("The current password is not correct.");
        return;
      }
      const { error: updateError } = await auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      // End every other session; the change itself succeeded, so ignore a failure here.
      await auth.signOut({ scope: "others" }).catch(() => undefined);
      setCurrent("");
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
        label="Current password"
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        slotProps={{ htmlInput: { autoComplete: "current-password" } }}
        fullWidth
        margin="normal"
      />
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
