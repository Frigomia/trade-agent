"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  TextField,
  Button,
  Alert,
  Typography,
  Checkbox,
  FormControlLabel,
} from "@mui/material";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api/client";
import { useClientSession } from "@/lib/auth/useClientSession";

export default function AcceptInvitationPage() {
  const router = useRouter();
  const { session, checkingSession } = useClientSession();
  const email = session?.user.email ?? null;
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setSubmitting(false);
      setError(updateError.message);
      return;
    }
    try {
      await apiFetch("/me/accept", {
        method: "POST",
        body: JSON.stringify({ accept_terms: true }),
      });
      router.push("/today");
    } catch {
      setSubmitting(false);
      setError("Something went wrong recording your acceptance. Try again.");
    }
  }

  if (checkingSession) {
    return null;
  }

  if (!email) {
    return (
      <Box sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
        <Alert severity="warning">
          This invitation link is no longer valid — it may have expired or already been used. Ask
          your administrator to resend it.
        </Alert>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 650 }}>
        Set your password
      </Typography>
      <Typography sx={{ color: "var(--muted)", mt: 0.5 }}>
        The administrator invited you to trade-agent. This link expires in 24 hours.
      </Typography>
      <TextField label="Email" value={email} fullWidth margin="normal" disabled />
      <TextField
        label="Create password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      <TextField
        label="Confirm password"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      <FormControlLabel
        control={
          <Checkbox checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
        }
        label="I understand trade-agent gives advisory information only and is not investment advice."
      />
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button
        type="submit"
        variant="contained"
        fullWidth
        sx={{ mt: 2 }}
        disabled={!acceptedTerms || submitting}
      >
        Create account
      </Button>
    </Box>
  );
}
