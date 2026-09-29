"use client";

import useSWR from "swr";
import { Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, Chip } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { AdminUserOut } from "@/lib/api/admin-types";

export default function AdminUsagePage() {
  const { data: users } = useSWR<AdminUserOut[]>("/admin/users", apiFetch);

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 650, mb: 2 }}>
        Usage and limits
      </Typography>
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
