"use client";

import { useState } from "react";
import useSWR from "swr";
import { Box, Typography, Alert, Button, Chip, IconButton } from "@mui/material";
import { Plus, MoreHorizontal } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";
import { InviteDrawer } from "@/components/admin/InviteDrawer";

type StatusFilter = "all" | "active" | "invited" | "disabled";

export default function AdminPage() {
  const { data: users, mutate } = useSWR<AdminUserOut[]>("/admin/users", apiFetch);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [inviteOpen, setInviteOpen] = useState(false);

  const filtered = (users ?? []).filter((u) => filter === "all" || u.status === filter);

  async function handleResend(id: string) {
    await apiFetch(`/admin/users/${id}/resend`, { method: "POST" });
    mutate();
  }

  async function handleRevoke(id: string) {
    await apiFetch(`/admin/users/${id}/revoke`, { method: "POST" });
    mutate();
  }

  async function handleEnable(id: string) {
    await apiFetch(`/admin/users/${id}/enable`, { method: "POST" });
    mutate();
  }

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        You manage access, not data.
      </Alert>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 650 }}>
          Users
        </Typography>
        <Box sx={{ flex: 1 }} />
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
          {user.status === "active" && (
            <IconButton size="small" aria-label="User details">
              <MoreHorizontal size={18} />
            </IconButton>
          )}
        </Box>
      ))}
      <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={() => mutate()} />
    </Box>
  );
}
