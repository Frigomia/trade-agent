"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Box, TextField, Button, Alert, Typography } from "@mui/material";
import { createClient } from "@/lib/supabase/client";
import { useClientSession } from "@/lib/auth/useClientSession";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { session, checkingSession } = useClientSession();
  const hasSession = Boolean(session);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleRequest(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.push("/today");
  }

  if (checkingSession) {
    return null;
  }

  if (hasSession) {
    return (
      <Box component="form" onSubmit={handleConfirm} sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 650 }}>
          Choose a new password
        </Typography>
        <TextField
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          margin="normal"
          required
        />
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
        <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
          Save password
        </Button>
      </Box>
    );
  }

  if (sent) {
    return (
      <Box sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
        <Alert severity="success">Check your email for a link to reset your password.</Alert>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={handleRequest} sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 650 }}>
        Reset your password
      </Typography>
      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
        Send reset link
      </Button>
    </Box>
  );
}
