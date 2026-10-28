"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Box, TextField, Button, Alert, InputAdornment } from "@mui/material";
import { Lock, Mail } from "lucide-react";
import { AuthHeading, AuthPanel, AuthShell } from "@/components/auth/AuthShell";
import { createClient } from "@/lib/supabase/client";
import { useClientSession } from "@/lib/auth/useClientSession";
import { clearRecoveryCookie, hasRecoveryCookie, siteOrigin } from "@/lib/auth/recovery";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { session, checkingSession } = useClientSession();
  const [recoveryEvent, setRecoveryEvent] = useState(false);
  // The form changes the signed-in user's password, so it is only offered inside a recovery
  // context: the reset link's redirect (cookie from /auth/confirm) or a PASSWORD_RECOVERY event.
  // Any other signed-in visitor goes to the account page; a failed link must not expose it.
  const recovery = !checkingSession && Boolean(session) && (recoveryEvent || hasRecoveryCookie());
  const needsAccountPage = !checkingSession && Boolean(session) && !recovery;

  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryEvent(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (needsAccountPage) router.replace("/more/account");
  }, [needsAccountPage, router]);
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
      redirectTo: `${siteOrigin()}/reset-password`,
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
    clearRecoveryCookie();
    router.push("/today");
  }

  if (checkingSession || needsAccountPage) {
    return null;
  }

  if (recovery) {
    return (
      <AuthShell>
        <Box component="form" onSubmit={handleConfirm}>
          <AuthHeading title="Choose a new password" subtitle={session?.user.email} />
          <AuthPanel>
            <TextField
              label="New password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              required
              autoComplete="new-password"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start" sx={{ color: "var(--muted)" }}>
                      <Lock size={17} />
                    </InputAdornment>
                  ),
                },
              }}
            />
            {error && <Alert severity="error">{error}</Alert>}
            <Button type="submit" variant="contained" fullWidth disabled={submitting}>
              Save password
            </Button>
          </AuthPanel>
        </Box>
      </AuthShell>
    );
  }

  if (sent) {
    return (
      <AuthShell>
        <Alert severity="success" icon={<Mail size={17} />}>
          Check your email for a link to reset your password.
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Box component="form" onSubmit={handleRequest}>
        <AuthHeading title="Reset your password" subtitle="We will email you a link to choose a new one." />
        <AuthPanel>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
            autoComplete="email"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start" sx={{ color: "var(--muted)" }}>
                    <Mail size={17} />
                  </InputAdornment>
                ),
              },
            }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" fullWidth disabled={submitting}>
            Send reset link
          </Button>
        </AuthPanel>
      </Box>
    </AuthShell>
  );
}
