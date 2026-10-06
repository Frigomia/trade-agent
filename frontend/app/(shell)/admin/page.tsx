"use client";

import { useState } from "react";
import useSWR from "swr";
import { Box, Typography, Alert, Button, Chip, IconButton, useMediaQuery, useTheme } from "@mui/material";
import { Plus, MoreHorizontal } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";
import { InviteDrawer } from "@/components/admin/InviteDrawer";
import { UserDetailContent, UserDetailDrawer } from "@/components/admin/UserDetailDrawer";
import { ClaudeStateChip, chipKind } from "@/components/claude/ClaudeStateChip";
import { PageHeader } from "@/components/shell/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Panel } from "@/components/ui/Panel";

type StatusFilter = "all" | "active" | "invited" | "disabled";

// Only people who have signed in have limits and access to manage.
// Fixed desktop column widths so the header and every row line up.
const ROLE_W = 64;
const STATUS_W = 84;
const CLAUDE_W = 128;
const ACTIONS_W = 150;

const hasDetail = (user: AdminUserOut) => user.status === "active" || user.status === "disabled";

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

  const isDesktop = useMediaQuery(useTheme().breakpoints.up("md"));
  const selectedUser = users?.find((u) => u.id === selectedUserId) ?? null;

  const filtered = (users ?? []).filter((u) => filter === "all" || u.status === filter);

  async function handleAction(id: string, action: "resend" | "revoke" | "enable") {
    try {
      await apiFetch(`/admin/users/${id}/${action}`, { method: "POST" });
      setActionError(null);
      mutate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.detail : "Something went wrong.");
    }
  }

  return (
    <Box>
      {(loadError || actionError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError ? "Could not load users." : actionError}
        </Alert>
      )}
      <PageHeader
        title="Users"
        actions={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setInviteOpen(true)}>
            Invite user
          </Button>
        }
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        You manage access, not data.
      </Alert>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
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
      <Box
        // minmax(0, 1fr) on phones too: a bare grid column is `auto`, which grows to its widest row.
        sx={{ display: "grid", gap: 2.25, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) 340px" }, maxWidth: 1080 }}
      >
      <Box>
      <Panel sx={{ p: "4px 18px" }}>
      <Box
        aria-hidden
        sx={{ display: { xs: "none", md: "flex" }, gap: 1.5, py: 1, fontSize: 12, fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}
      >
        <Box sx={{ flex: 1 }}>Person</Box>
        <Box sx={{ width: ROLE_W }}>Role</Box>
        <Box sx={{ width: STATUS_W }}>Status</Box>
        <Box sx={{ width: CLAUDE_W }}>Claude</Box>
        <Box sx={{ width: ACTIONS_W }} />
      </Box>
      {filtered.map((user) => {
        const clickable = isDesktop && hasDetail(user);
        return (
        <Box
          key={user.id}
          onClick={clickable ? () => setSelectedUserId(user.id) : undefined}
          sx={{
            display: "flex",
            alignItems: "center",
            // Wrap so a long address or the Resend/Revoke buttons drop to a second line on a phone.
            flexWrap: "wrap",
            gap: 1.5,
            py: 1.5,
            borderBottom: "1px solid var(--line)",
            "&:last-of-type": { borderBottom: 0 },
            cursor: clickable ? "pointer" : "default",
            ...(clickable && user.id === selectedUserId && { bgcolor: "var(--up-bg)", borderRadius: "12px" }),
          }}
        >
          <Avatar email={user.email} />
          <Typography
            sx={{ fontWeight: 600, flex: "1 1 96px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {user.email}
          </Typography>
          {/* On a phone the role and status drop out; the Claude chip sits at the right. */}
          <Box sx={{ display: { xs: "none", md: "block" }, width: ROLE_W }}>
            <Chip label={user.role} size="small" />
          </Box>
          <Box sx={{ display: { xs: "none", md: "block" }, width: STATUS_W }}>
            <Chip label={user.status} size="small" color={user.status === "disabled" ? "error" : "default"} />
          </Box>
          <Box sx={{ flex: "none", width: { md: CLAUDE_W } }}>
            <ClaudeStateChip kind={chipKind(user.claude_key_state)} />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", width: { xs: "100%", md: ACTIONS_W }, justifyContent: "flex-end", "&:empty": { display: "none" } }}>
          {user.status === "invited" && (
            <>
              <Button size="small" onClick={() => handleAction(user.id, "resend")}>
                Resend
              </Button>
              <Button size="small" onClick={() => handleAction(user.id, "revoke")}>
                Revoke
              </Button>
            </>
          )}
          {user.status === "disabled" && (
            <Button size="small" onClick={() => handleAction(user.id, "enable")}>
              Enable
            </Button>
          )}
          {hasDetail(user) && (
            <IconButton
              size="small"
              aria-label="User details"
              onClick={() => setSelectedUserId(user.id)}
            >
              <MoreHorizontal size={18} />
            </IconButton>
          )}
          </Box>
        </Box>
        );
      })}
      </Panel>
      <Typography sx={{ fontSize: 12.5, color: "var(--muted)", mt: 1.5, px: 0.5 }}>
        You see only whether a key is connected, never the key and never its digits.
      </Typography>
      </Box>
      {isDesktop && (
        <Panel sx={{ p: "20px 22px", position: "sticky", top: 24, maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
          {selectedUser ? (
            <UserDetailContent
              key={selectedUser.id}
              user={selectedUser}
              onClose={() => setSelectedUserId(null)}
              onChanged={() => mutate()}
            />
          ) : (
            <Typography sx={{ fontSize: 13.5, color: "var(--muted)" }}>
              Select a user to see their limits and access.
            </Typography>
          )}
        </Panel>
      )}
      </Box>
      <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={() => mutate()} />
      {!isDesktop && (
        <UserDetailDrawer
          key={selectedUserId ?? "none"}
          user={selectedUser}
          onClose={() => setSelectedUserId(null)}
          onChanged={() => mutate()}
        />
      )}
    </Box>
  );
}
