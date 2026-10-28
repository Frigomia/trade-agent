"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Box, TextField, Button, Alert } from "@mui/material";
import { AckCheckbox } from "@/components/auth/AckCheckbox";
import { AuthHeading, AuthPanel, AuthShell } from "@/components/auth/AuthShell";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api/client";
import { useClientSession } from "@/lib/auth/useClientSession";

const MIN_PASSWORD_LENGTH = 8;

export default function AcceptInvitationPage() {
  const router = useRouter();
  const { session, checkingSession } = useClientSession();
  // The invited account as the backend sees it. `undefined` while loading; `null` when there is
  // no session or the account is not an invited one. A browser that still holds another session
  // (the admin's, say) must never get this form: it would change that person's password.
  const [fetchedEmail, setFetchedEmail] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    apiFetch<{ email: string; status: string }>("/me")
      .then((me) => {
        if (!cancelled) setFetchedEmail(me.status === "invited" ? me.email : null);
      })
      .catch(() => {
        if (!cancelled) setFetchedEmail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);
  const invitedEmail = checkingSession ? undefined : session ? fetchedEmail : null;

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const passwordsDiffer = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirmPassword &&
    acceptedTerms &&
    !submitting;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
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

  if (invitedEmail === undefined) {
    return null;
  }

  if (!invitedEmail) {
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
        <AuthPanel>
          <TextField label="Email" value={invitedEmail} fullWidth disabled />
          <TextField
            label="Create password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            required
            autoComplete="new-password"
            error={passwordTooShort}
            helperText={
              passwordTooShort ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : undefined
            }
          />
          <TextField
            label="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            fullWidth
            required
            autoComplete="new-password"
            error={passwordsDiffer}
            helperText={passwordsDiffer ? "Passwords don't match." : undefined}
          />
          <AckCheckbox
            checked={acceptedTerms}
            onChange={setAcceptedTerms}
            label="I understand trade-agent gives advisory information only and is not investment advice."
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" fullWidth disabled={!canSubmit}>
            Create account
          </Button>
        </AuthPanel>
      </Box>
    </AuthShell>
  );
}
