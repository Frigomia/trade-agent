"use client";

import useSWR from "swr";
import { AlertTriangle } from "lucide-react";
import { Box, Table, TableHead, TableBody, TableRow, TableCell, Typography, Alert } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";
import { DefaultLimitsPanel } from "@/components/admin/DefaultLimitsPanel";
import { PageHeader } from "@/components/shell/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Bar } from "@/components/ui/Bar";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { usageFraction, usageLevel, type UsageDetail } from "@/lib/usage";

// Both limit levels are amber with a word and an icon: red is for price moves only.
const LEVEL = {
  ok: { tone: "accent", label: "OK", caution: false },
  warn: { tone: "warn", label: "Near limit", caution: true },
  limit: { tone: "warn", label: "At limit", caution: true },
} as const;

// On a phone each table row becomes a two-column card (see TABLE_SX), so the cells cannot keep a
// fixed minimum width; the label comes from `data-label` via CSS, so the DOM text is not duplicated.
function UsageCell({ usage, name }: { usage: UsageDetail; name: string }) {
  const level = LEVEL[usageLevel(usage)];
  return (
    <Box sx={{ minWidth: { md: 120 } }}>
      <Typography sx={{ fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}>
        {usage.used} / {usage.limit || "—"}
      </Typography>
      <Bar
        label={name}
        value={usageFraction(usage) * 100}
        valueText={usage.limit ? `${usage.used} of ${usage.limit}` : `${usage.used} used, no limit`}
        caution={level.caution}
        sx={{ mt: 0.75, height: 6 }}
      />
    </Box>
  );
}

const phone = (value: Record<string, unknown>) => ({ "@media (max-width: 899.95px)": value });

// Below `md` the table is laid out as cards: the user on the first line, the two usage meters and
// the status on the second, so nothing is wider than the screen.
const TABLE_SX = {
  // td/th (not .MuiTableCell-root) so the phone card rules below, which name `td`, still win.
  "& td, & th": { fontSize: "0.8125rem", padding: "12px 8px" },
  "& th": { fontWeight: 500 },
  ...phone({
    display: "block",
    "& thead": { display: "none" },
    "& tbody": { display: "block" },
    "& tr": {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
      columnGap: "16px",
      rowGap: "10px",
      alignItems: "center",
      padding: "14px 0",
      borderBottom: "1px solid var(--line)",
    },
    "& tr:last-of-type": { borderBottom: 0 },
    "& td": { display: "block", border: 0, padding: 0, minWidth: 0 },
    "& td[data-label]::before": {
      content: "attr(data-label)",
      display: "block",
      fontSize: "0.75rem",
      color: "var(--muted)",
      marginBottom: "2px",
    },
    "& td[data-cell=user]": { gridColumn: "1 / -1", gridRow: 1 },
    "& td[data-cell=analysis]": { gridColumn: "1 / 2", gridRow: 2 },
    "& td[data-cell=chat]": { gridColumn: "2 / 3", gridRow: 2 },
    "& td[data-cell=status]": { gridColumn: "3 / 4", gridRow: 2, alignSelf: "end" },
    "& tr[data-total] td:empty": { display: "none" },
  }),
};

export default function AdminUsagePage() {
  const { data: users, error: loadError, mutate } = useSWR<AdminUserOut[]>("/admin/users", apiFetch);
  const rows = (users ?? []).map((user) => {
    const analysis = { used: user.monthly_analysis_used ?? 0, limit: user.monthly_analysis_limit ?? 0 };
    const chat = { used: user.monthly_chat_used ?? 0, limit: user.monthly_chat_limit ?? 0 };
    const levels = [usageLevel(analysis), usageLevel(chat)];
    const level = levels.includes("limit") ? "limit" : levels.includes("warn") ? "warn" : "ok";
    return { ...user, analysis, chat, level } as const;
  });
  const totalAnalysis = rows.reduce((sum, row) => sum + row.analysis.used, 0);
  const totalChat = rows.reduce((sum, row) => sum + row.chat.used, 0);

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
      <Box
        sx={{ display: "grid", gap: 2, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "320px minmax(0, 1fr)" }, maxWidth: 1180 }}
      >
      <DefaultLimitsPanel onSaved={() => void mutate()} />
      <Panel sx={{ p: "4px 20px" }}>
        <Table sx={TABLE_SX}>
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
                <TableCell data-cell="user">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
                    <Avatar email={user.email} />
                    <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: { xs: "nowrap", md: "normal" } }}>
                      {user.email}
                    </Box>
                  </Box>
                </TableCell>
                <TableCell data-cell="analysis" data-label="Analysis runs">
                  <UsageCell usage={user.analysis} name={`${user.email}, analysis runs`} />
                </TableCell>
                <TableCell data-cell="chat" data-label="Chat messages">
                  <UsageCell usage={user.chat} name={`${user.email}, chat messages`} />
                </TableCell>
                <TableCell data-cell="status" align="right">
                  <Pill tone={LEVEL[user.level].tone}>
                    {user.level !== "ok" && <AlertTriangle size={12} aria-hidden />}
                    {LEVEL[user.level].label}
                  </Pill>
                </TableCell>
              </TableRow>
            ))}
            <TableRow data-total="">
              <TableCell data-cell="user" sx={{ fontWeight: 650 }}>
                Total
              </TableCell>
              <TableCell data-cell="analysis" sx={{ fontWeight: 650 }}>
                {totalAnalysis} runs
              </TableCell>
              <TableCell data-cell="chat" sx={{ fontWeight: 650 }}>
                {totalChat} messages
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </Panel>
      </Box>
    </Box>
  );
}
