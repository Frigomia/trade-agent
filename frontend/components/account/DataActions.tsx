"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import { downloadJson } from "@/lib/download";
import { todayIso } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useAction } from "@/lib/useAction";

export function DataActions({ email }: { email: string }) {
  const router = useRouter();
  const { run, submitting, error } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  function handleExport() {
    void run(async () => downloadJson(`trade-agent-export-${todayIso()}.json`, await apiFetch("/me/export")));
  }

  function handleDelete() {
    void run(async () => {
      await apiFetch("/me/data", { method: "DELETE", body: JSON.stringify({ confirm: true }) });
      await mutate(() => true, undefined, { revalidate: false });
      await createClient().auth.signOut();
      router.push("/login");
    });
  }

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Button variant="outlined" onClick={handleExport} disabled={submitting}>
          Export my data
        </Button>
        {!confirming && (
          <Button color="error" variant="outlined" onClick={() => setConfirming(true)}>
            Delete my data
          </Button>
        )}
      </Box>
      {confirming && (
        <Box sx={{ display: "grid", gap: 1.5 }}>
          <Typography sx={{ fontSize: 14 }}>
            This permanently deletes your holdings, watchlist, trades, recommendations, chats, backtests,
            preferences and snapshots.
          </Typography>
          <Typography sx={{ color: "var(--muted)", fontSize: 13 }}>
            Your sign-in and access stay. Removing access is done by your administrator.
          </Typography>
          <TextField
            label="Type your email to confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button color="error" variant="contained" disabled={!matches || submitting} onClick={handleDelete}>
              Confirm delete my data
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                setTyped("");
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}
