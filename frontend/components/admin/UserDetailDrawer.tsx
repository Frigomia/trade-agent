"use client";

import { useState, type FormEvent } from "react";
import { Drawer, Box, Typography, TextField, Button, Alert, Divider, IconButton } from "@mui/material";
import { X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";

interface UserDetailProps {
  user: AdminUserOut;
  onClose: () => void;
  onChanged: () => void;
}

/** A user's limits, access and removal controls. Shown in a drawer on phones and inline on desktop. */
export function UserDetailContent({ user, onClose, onChanged }: UserDetailProps) {
  const [analysisLimit, setAnalysisLimit] = useState("");
  const [chatLimit, setChatLimit] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function patchLimits(body: Record<string, number | null>) {
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
    const body: Record<string, number> = {};
    if (analysisLimit !== "") body.analysis_limit = Number(analysisLimit);
    if (chatLimit !== "") body.chat_limit = Number(chatLimit);
    if (Object.keys(body).length === 0) {
      return;
    }
    setSubmitting(true);
    await patchLimits(body);
    setSubmitting(false);
  }

  async function handleStatusAction(action: "disable" | "enable") {
    setError(null);
    try {
      await apiFetch(`/admin/users/${user.id}/${action}`, { method: "POST" });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  async function handleRemove() {
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
    <Box>
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
          <Button variant="outlined" fullWidth onClick={() => handleStatusAction("disable")}>
            Disable
          </Button>
        )}
        {user.status === "disabled" && (
          <Button variant="outlined" fullWidth onClick={() => handleStatusAction("enable")}>
            Enable
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
  );
}

interface UserDetailDrawerProps extends Omit<UserDetailProps, "user"> {
  user: AdminUserOut | null;
}

export function UserDetailDrawer({ user, onClose, onChanged }: UserDetailDrawerProps) {
  if (!user) return null;
  // A bottom sheet, not a side drawer: a 400px drawer is wider than a phone, so the backdrop was
  // unreachable and nothing closed it. Here the page stays visible above the sheet (tap it to
  // dismiss), the header with the Close button stays put while the long form scrolls, and Escape works.
  return (
    <Drawer
      anchor="bottom"
      open
      onClose={onClose}
      slotProps={{
        paper: { sx: { maxHeight: "92dvh", borderTopLeftRadius: 20, borderTopRightRadius: 20 } },
      }}
    >
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          bgcolor: "inherit",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          px: 1.5,
          pt: 1.5,
          pb: 0.5,
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: 8,
            left: "50%",
            width: 36,
            height: 4,
            borderRadius: 2,
            bgcolor: "var(--line2)",
            transform: "translateX(-50%)",
          }}
        />
        <IconButton aria-label="Close" onClick={onClose} size="small">
          <X size={20} />
        </IconButton>
      </Box>
      <Box sx={{ px: 3, pb: 3 }}>
        <UserDetailContent user={user} onClose={onClose} onChanged={onChanged} />
      </Box>
    </Drawer>
  );
}
