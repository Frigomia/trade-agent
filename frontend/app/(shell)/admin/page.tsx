"use client";

import { useState } from "react";
import useSWR from "swr";
import { Box, Typography, Alert, Button, IconButton, useMediaQuery, useTheme } from "@mui/material";
import { MoreHorizontal, Plus } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";
import { RolePill, StatusPill } from "@/components/admin/StatusPill";
import { InviteDrawer } from "@/components/admin/InviteDrawer";
import { UserDetailContent, UserDetailDrawer } from "@/components/admin/UserDetailDrawer";
import { ClaudeStateChip, chipKind } from "@/components/claude/ClaudeStateChip";
import { PageHeader } from "@/components/shell/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

type StatusFilter = "all" | "active" | "invited" | "disabled";

// Fixed desktop column widths so the header and every row line up.
const ROLE_W = 64;
const STATUS_W = 104;
const CLAUDE_W = 140;
const ACTIONS_W = 150;

// 36px on a desktop, 44px on a phone.
const TOUCH = { minHeight: { xs: 44, md: 36 }, px: { xs: 1.75, md: 1.25 } } as const;

// Only people who have signed in have limits and access to manage.
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
      <SegmentedControl
        label="Filter users"
        fill
        value={filter}
        onChange={setFilter}
        sx={{ mb: 2 }}
        segments={(["all", "active", "invited", "disabled"] as const).map((value) => {
          const label = `${value[0].toUpperCase()}${value.slice(1)}`;
          const count = value === "all" ? (users ?? []).length : (users ?? []).filter((u) => u.status === value).length;
          return { key: value, label, count, ariaLabel: `${label}, ${count}` };
        })}
      />
      <Box
        // minmax(0, 1fr) on phones too: a bare grid column is `auto`, which grows to its widest row.
        sx={{ display: "grid", gap: 2.25, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) 340px" }, maxWidth: 1080 }}
      >
      <Box>
      <Panel sx={{ p: "4px 20px" }}>
      <Box
        aria-hidden
        sx={{ display: { xs: "none", md: "flex" }, gap: 1.5, py: 1, fontSize: "0.75rem", fontWeight: 500, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}
      >
        <Box sx={{ flex: 1 }}>Person</Box>
        <Box sx={{ width: ROLE_W }}>Role</Box>
        <Box sx={{ width: STATUS_W }}>Status</Box>
        <Box sx={{ width: CLAUDE_W }}>Claude</Box>
        <Box sx={{ width: ACTIONS_W }} />
      </Box>
      {filtered.map((user) => {
        const clickable = isDesktop && hasDetail(user);
        const at = user.email.indexOf("@") + 1; // 0 when there is no @: the whole address after the break
        return (
        <Box
          key={user.id}
          onClick={clickable ? () => setSelectedUserId(user.id) : undefined}
          sx={{
            // A phone is a small grid: avatar, the whole address and the details button on top, then the
            // status chips, then the row's buttons, both under the address. A computer is one table row.
            display: { xs: "grid", md: "flex" },
            gridTemplateColumns: "auto minmax(0, 1fr) auto",
            alignItems: "center",
            columnGap: 1.5,
            rowGap: 1,
            py: 1.5,
            borderBottom: "1px solid var(--line)",
            "&:last-of-type": { borderBottom: 0 },
            cursor: clickable ? "pointer" : "default",
            ...(clickable && user.id === selectedUserId && { bgcolor: "var(--accent-wash)", borderRadius: "14px", px: "10px", mx: "-10px", borderColor: "transparent" }),
          }}
        >
          <Avatar email={user.email} />
          {/* The address wraps on a phone, so it is never cut to "mianfrigo@g…"; a computer keeps one line. */}
          <Typography
            sx={{ fontWeight: 600, flex: { md: "1 1 96px" }, minWidth: 0, overflowWrap: "anywhere", overflow: { md: "hidden" }, textOverflow: { md: "ellipsis" }, whiteSpace: { md: "nowrap" } }}
          >
            {/* A break point after the @, so a phone splits "name@" and "domain.com" rather than mid-word. */}
            {user.email.slice(0, at)}
            <wbr />
            {user.email.slice(at)}
          </Typography>
          {/* On a phone only the role drops out. The chips share a row under the address; from md they are table columns. */}
          <Box sx={{ display: { xs: "none", md: "block" }, width: ROLE_W }}>
            <RolePill role={user.role} />
          </Box>
          <Box sx={{ display: { xs: "flex", md: "contents" }, flexWrap: "wrap", alignItems: "center", gap: 1, gridColumn: "2 / -1", gridRow: 2 }}>
            <Box sx={{ flex: "none", width: { md: STATUS_W } }}>
              <StatusPill status={user.status} />
            </Box>
            <Box sx={{ flex: "none", width: { md: CLAUDE_W } }}>
              <ClaudeStateChip kind={chipKind(user.claude_key_state, user.role)} />
            </Box>
          </Box>
          <Box sx={{ display: { xs: "contents", md: "flex" }, alignItems: "center", gap: 0.5, width: { md: ACTIONS_W }, justifyContent: "flex-end" }}>
            {(user.status === "invited" || user.status === "disabled") && (
              <Box sx={{ display: { xs: "flex", md: "contents" }, flexWrap: "wrap", gap: 0.5, gridColumn: "2 / -1", gridRow: 3, ml: { xs: -1.25, md: 0 } }}>
                {user.status === "invited" && (
                  <>
                    <Button size="small" sx={TOUCH} onClick={() => handleAction(user.id, "resend")}>
                      Resend
                    </Button>
                    <Button size="small" sx={TOUCH} onClick={() => handleAction(user.id, "revoke")}>
                      Revoke
                    </Button>
                  </>
                )}
                {user.status === "disabled" && (
                  <Button size="small" sx={TOUCH} onClick={() => handleAction(user.id, "enable")}>
                    Enable
                  </Button>
                )}
              </Box>
            )}
            {hasDetail(user) && (
              <IconButton
                size="small"
                aria-label="User details"
                sx={{ gridColumn: 3, gridRow: 1, mr: { xs: -1, md: 0 }, width: { xs: 44, md: 36 }, height: { xs: 44, md: 36 }, color: "var(--muted)" }}
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
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", mt: 1.5, px: 0.5, lineHeight: 1.5 }}>
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
            <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
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
