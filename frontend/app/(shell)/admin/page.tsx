"use client";

import { useState } from "react";
import useSWR from "swr";
import { Box, Typography, Alert, Button, Chip, IconButton } from "@mui/material";
import { Plus, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";
import { InviteDrawer } from "@/components/admin/InviteDrawer";
import { UserDetailDrawer } from "@/components/admin/UserDetailDrawer";

type StatusFilter = "all" | "active" | "invited" | "disabled";

export default function AdminPage() {
  const {
    data: users,
    error: loadError,
    mutate,
  } = useSWR<AdminUserOut[]>("/admin/users", apiFetch);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = (users ?? []).filter((u) => filter === "all" || u.status === filter);

  async function handleResend(id: string) {
    try {
      await apiFetch(`/admin/users/${id}/resend`, { method: "POST" });
      setActionError(null);
      mutate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  async function handleRevoke(id: string) {
    try {
      await apiFetch(`/admin/users/${id}/revoke`, { method: "POST" });
      setActionError(null);
      mutate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  async function handleEnable(id: string) {
    try {
      await apiFetch(`/admin/users/${id}/enable`, { method: "POST" });
      setActionError(null);
      mutate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        You manage access, not data.
      </Alert>
      {(loadError || actionError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError ? "Could not load users." : actionError}
        </Alert>
      )}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 650 }}>
          Users
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Link href="/admin/usage">View usage</Link>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setInviteOpen(true)}>
          Invite user
        </Button>
      </Box>
      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        {(["all", "active", "invited", "disabled"] as const).map((value) => {
          const count =
            value === "all" ? (users ?? []).length : (users ?? []).filter((u) => u.status === value).length;
          return (
            <Chip
              key={value}
              label={`${value[0].toUpperCase()}${value.slice(1)} ${count}`}
              onClick={() => setFilter(value)}
              color={filter === value ? "primary" : "default"}
            />
          );
        })}
      </Box>
      {filtered.map((user) => (
        <Box
          key={user.id}
          sx={{ display: "flex", alignItems: "center", gap: 2, py: 1.5, borderBottom: "1px solid var(--line)" }}
        >
          <Typography sx={{ fontWeight: 600, flex: 1 }}>{user.email}</Typography>
          <Chip label={user.role} size="small" />
          <Chip label={user.status} size="small" color={user.status === "disabled" ? "error" : "default"} />
          {user.status === "invited" && (
            <>
              <Button size="small" onClick={() => handleResend(user.id)}>
                Resend
              </Button>
              <Button size="small" onClick={() => handleRevoke(user.id)}>
                Revoke
              </Button>
            </>
          )}
          {user.status === "disabled" && (
            <Button size="small" onClick={() => handleEnable(user.id)}>
              Enable
            </Button>
          )}
          {(user.status === "active" || user.status === "disabled") && (
            <IconButton
              size="small"
              aria-label="User details"
              onClick={() => setSelectedUserId(user.id)}
            >
              <MoreHorizontal size={18} />
            </IconButton>
          )}
        </Box>
      ))}
      <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={() => mutate()} />
      <UserDetailDrawer
        key={selectedUserId ?? "none"}
        user={users?.find((u) => u.id === selectedUserId) ?? null}
        onClose={() => setSelectedUserId(null)}
        onChanged={() => mutate()}
      />
    </Box>
  );
}
