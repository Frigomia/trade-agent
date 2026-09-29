"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Box, TextField, Button, Alert, Typography } from "@mui/material";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError("Email or password is incorrect. Try again or reset your password.");
      return;
    }
    router.push("/today");
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 380, mx: "auto", mt: 8, p: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 650 }}>
        Sign in
      </Typography>
      <Typography sx={{ color: "var(--muted)", mt: 0.5 }}>to your trade-agent account</Typography>
      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        fullWidth
        margin="normal"
        required
      />
      <TextField
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        fullWidth
        margin="normal"
        required
        error={Boolean(error)}
      />
      <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
        <Link href="/reset-password" style={{ fontSize: 13 }}>
          Forgot password?
        </Link>
      </Box>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
        Sign in
      </Button>
      <Typography sx={{ color: "var(--muted)", fontSize: 13, mt: 3 }}>
        trade-agent is by invitation only. If you don&apos;t have an account, ask the
        administrator to invite you.
      </Typography>
    </Box>
  );
}
