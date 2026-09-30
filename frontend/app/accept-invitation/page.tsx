"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  TextField,
  Button,
  Alert,
  Checkbox,
  FormControlLabel,
} from "@mui/material";
import { AuthHeading, AuthShell } from "@/components/auth/AuthShell";
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
      <AuthShell>
        <Alert severity="warning">
          This invitation link is no longer valid — it may have expired or already been used. Ask
          your administrator to resend it.
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Box component="form" onSubmit={handleSubmit}>
        <AuthHeading
          title="Set your password"
          subtitle="The administrator invited you to trade-agent. This link expires in 24 hours."
        />
        <TextField
          label="Email"
          value={email}
          fullWidth
          margin="normal"
          disabled
          sx={{ mt: 3.25 }}
        />
        <TextField
          label="Create password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          margin="normal"
          required
          autoComplete="new-password"
        />
        <TextField
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          fullWidth
          margin="normal"
          required
          autoComplete="new-password"
        />
        <FormControlLabel
          sx={{ alignItems: "flex-start", mt: 1.5, mx: 0, "& .MuiFormControlLabel-label": { fontSize: 12.5, color: "var(--text2)", lineHeight: 1.45, pt: 0.5 } }}
          control={
            <Checkbox
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              sx={{ p: 0.5, mr: 1 }}
            />
          }
          label="I understand trade-agent gives advisory information only and is not investment advice."
        />
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
        <Button
          type="submit"
          variant="contained"
          fullWidth
          sx={{ mt: 2.25 }}
          disabled={!acceptedTerms || submitting}
        >
          Create account
        </Button>
      </Box>
    </AuthShell>
  );
}
