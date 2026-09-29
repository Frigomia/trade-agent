"use client";

import { useState, type FormEvent } from "react";
import { Drawer, Box, Typography, TextField, Button, Alert, Divider } from "@mui/material";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";

interface UserDetailDrawerProps {
  user: AdminUserOut | null;
  onClose: () => void;
  onChanged: () => void;
}

export function UserDetailDrawer({ user, onClose, onChanged }: UserDetailDrawerProps) {
  const [analysisLimit, setAnalysisLimit] = useState("");
  const [chatLimit, setChatLimit] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!user) {
    return null;
  }

  async function patchLimits(body: Record<string, number | null>) {
    if (!user) return;
    setError(null);
    try {
      await apiFetch(`/admin/users/${user.id}/limits`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  async function handleSetLimits(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    const body: Record<string, number> = {};
    if (analysisLimit !== "") body.analysis_limit = Number(analysisLimit);
    if (chatLimit !== "") body.chat_limit = Number(chatLimit);
    await patchLimits(body);
    setSubmitting(false);
  }

  async function handleDisable() {
    if (!user) return;
    setError(null);
    try {
      await apiFetch(`/admin/users/${user.id}/disable`, { method: "POST" });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  async function handleRemove() {
    if (!user) return;
    setError(null);
    try {
      await apiFetch(`/admin/users/${user.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm_email: confirmEmail }),
      });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  return (
    <Drawer anchor="right" open={Boolean(user)} onClose={onClose}>
      <Box sx={{ width: 400, p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 650 }}>
          {user.email}
        </Typography>
        <Typography sx={{ color: "var(--muted)", fontSize: 13, mt: 0.5 }}>{user.status}</Typography>

        <Divider sx={{ my: 2 }} />

        <Box component="form" onSubmit={handleSetLimits}>
          <Typography sx={{ fontWeight: 600, mb: 1 }}>Monthly limits</Typography>
          <TextField
            label={`Analysis runs (used ${user.monthly_analysis_used ?? 0} of ${
              user.monthly_analysis_limit ?? "—"
            })`}
            value={analysisLimit}
            onChange={(e) => setAnalysisLimit(e.target.value)}
            fullWidth
            margin="normal"
            type="number"
          />
          <Button size="small" onClick={() => patchLimits({ analysis_limit: null })}>
            Use default
          </Button>
          <TextField
            label={`Chat messages (used ${user.monthly_chat_used ?? 0} of ${
              user.monthly_chat_limit ?? "—"
            })`}
            value={chatLimit}
            onChange={(e) => setChatLimit(e.target.value)}
            fullWidth
            margin="normal"
            type="number"
          />
          <Button size="small" onClick={() => patchLimits({ chat_limit: null })}>
            Use default
          </Button>
          <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={submitting}>
            Save limits
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        {user.status === "active" && (
          <Button variant="outlined" fullWidth onClick={handleDisable}>
            Disable
          </Button>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography sx={{ fontWeight: 600, mb: 1 }}>Remove user</Typography>
        <Typography sx={{ color: "var(--muted)", fontSize: 13, mb: 1 }}>
          Type {user.email} to confirm. This permanently deletes their data.
        </Typography>
        <TextField
          label="Confirm email"
          value={confirmEmail}
          onChange={(e) => setConfirmEmail(e.target.value)}
          fullWidth
          margin="normal"
        />
        <Button
          color="error"
          variant="contained"
          fullWidth
          disabled={confirmEmail !== user.email}
          onClick={handleRemove}
        >
          Remove
        </Button>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Box>
    </Drawer>
  );
}
