"use client";

import useSWR from "swr";
import { Box, LinearProgress, Table, TableHead, TableBody, TableRow, TableCell, Typography, Alert } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";
import { PageHeader } from "@/components/shell/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { usageFraction, usageLevel, type UsageDetail } from "@/lib/usage";

const LEVEL = {
  ok: { tone: "up", label: "OK", color: "var(--accent)" },
  warn: { tone: "warn", label: "Near limit", color: "var(--warn)" },
  limit: { tone: "down", label: "At limit", color: "var(--down)" },
} as const;

function UsageCell({ usage }: { usage: UsageDetail }) {
  const { color } = LEVEL[usageLevel(usage)];
  return (
    <Box sx={{ minWidth: 110 }}>
      <Typography sx={{ fontSize: 13 }}>
        {usage.used} / {usage.limit || "—"}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={usageFraction(usage) * 100}
        sx={{ mt: 0.5, "& .MuiLinearProgress-bar": { bgcolor: color } }}
      />
    </Box>
  );
}

export default function AdminUsagePage() {
  const { data: users, error: loadError } = useSWR<AdminUserOut[]>("/admin/users", apiFetch);
  const rows = (users ?? []).map((user) => {
    const analysis = { used: user.monthly_analysis_used ?? 0, limit: user.monthly_analysis_limit ?? 0 };
    const chat = { used: user.monthly_chat_used ?? 0, limit: user.monthly_chat_limit ?? 0 };
    const levels = [usageLevel(analysis), usageLevel(chat)];
    const level = levels.includes("limit") ? "limit" : levels.includes("warn") ? "warn" : "ok";
    return { ...user, analysis, chat, level } as const;
  });

  return (
    <Box>
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load usage.
        </Alert>
      )}
      <PageHeader title="Usage and limits" />
      <Alert severity="info" sx={{ mb: 2 }}>
        You manage access, not data. Usage shows how much each person used the service, never what
        they asked or received.
      </Alert>
      <Panel sx={{ p: "4px 18px" }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>User</TableCell>
              <TableCell>Analysis runs</TableCell>
              <TableCell>Chat messages</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((user) => (
              <TableRow key={user.id} sx={{ "&:last-of-type td": { borderBottom: 0 } }}>
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                    <Avatar email={user.email} />
                    {user.email}
                  </Box>
                </TableCell>
                <TableCell>
                  <UsageCell usage={user.analysis} />
                </TableCell>
                <TableCell>
                  <UsageCell usage={user.chat} />
                </TableCell>
                <TableCell align="right">
                  <Pill tone={LEVEL[user.level].tone}>{LEVEL[user.level].label}</Pill>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </Box>
  );
}
