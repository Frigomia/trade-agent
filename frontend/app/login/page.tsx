"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import NextLink from "next/link";
import { Box, TextField, Button, Alert, IconButton, InputAdornment, Link } from "@mui/material";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { AuthHeading, AuthPanel, AuthShell } from "@/components/auth/AuthShell";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api/client";

export default function LoginPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    // A session can end without the sign-out buttons (expiry, another tab): drop whatever the previous
    // person's screens cached before this one signs in, as the sign-out buttons do.
    await mutate(() => true, undefined, { revalidate: false });
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setSubmitting(false);
      setError("Email or password is incorrect. Try again or reset your password.");
      return;
    }
    try {
      await apiFetch("/me");
    } catch {
      await supabase.auth.signOut();
      setSubmitting(false);
      setError("This account doesn't have access. Contact your administrator.");
      return;
    }
    router.push("/today");
  }

  return (
    <AuthShell>
      <Box component="form" onSubmit={handleSubmit}>
        <AuthHeading title="Sign in" subtitle="to your trade-agent account" />
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
          <TextField
            label="Password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            required
            autoComplete="current-password"
            error={Boolean(error)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start" sx={{ color: "var(--muted)" }}>
                    <Lock size={17} />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((shown) => !shown)}
                      edge="end"
                      sx={{ color: "var(--muted)", width: 44, height: 44 }}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: -0.5 }}>
            <Link
              component={NextLink}
              href="/reset-password"
              sx={{ fontSize: "0.8125rem", display: "inline-flex", alignItems: "center", minHeight: 44 }}
            >
              Forgot password?
            </Link>
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" fullWidth disabled={submitting}>
            Sign in
          </Button>
        </AuthPanel>
        <Alert severity="info" icon={<Mail size={17} />} sx={{ mt: 2 }}>
          trade-agent is by invitation only. If you don&apos;t have an account, ask the administrator
          to invite you.
        </Alert>
      </Box>
    </AuthShell>
  );
}
