"use client";

import Link from "next/link";
import useSWR from "swr";
import { Box, Table, TableHead, TableBody, TableRow, TableCell, Chip, Alert } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";
import { PageHeader } from "@/components/shell/PageHeader";

export default function AdminUsagePage() {
  const { data: users, error: loadError } = useSWR<AdminUserOut[]>("/admin/users", apiFetch);

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        You manage access, not data.
      </Alert>
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load usage.
        </Alert>
      )}
      <PageHeader title="Usage and limits" actions={<Link href="/admin">Back to users</Link>} />
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>User</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Analysis runs</TableCell>
            <TableCell>Chat messages</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(users ?? []).map((user) => (
            <TableRow key={user.id}>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Chip label={user.status} size="small" color={user.status === "disabled" ? "error" : "default"} />
              </TableCell>
              <TableCell>
                {user.monthly_analysis_used ?? 0} / {user.monthly_analysis_limit ?? "—"}
              </TableCell>
              <TableCell>
                {user.monthly_chat_used ?? 0} / {user.monthly_chat_limit ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
