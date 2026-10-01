"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import type { LimitDefaults } from "@/lib/api/admin-types";
import { Panel } from "@/components/ui/Panel";
import { useAction } from "@/lib/useAction";

const MAX_LIMIT = 2_147_483_647;

/** The monthly limits for everyone without a personal override. */
export function DefaultLimitsPanel({ onSaved }: { onSaved: () => void }) {
  const { data, error: loadError, mutate } = useSWR<LimitDefaults>("/admin/limit-defaults", apiFetch);

  return (
    <Panel sx={{ p: "18px 20px" }}>
      <Typography component="h2" sx={{ fontSize: 17, fontWeight: 650 }}>
        Default limits
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: "var(--muted)", mb: 1 }}>
        For everyone without a personal limit. Personal limits are set per person on the Users page.
      </Typography>
      {loadError && <Alert severity="error">Could not load the default limits.</Alert>}
      {data && (
        <DefaultLimitsForm
          key={`${data.analysis_limit}/${data.chat_limit}`}
          initial={data}
          onSaved={() => {
            void mutate();
            onSaved();
          }}
        />
      )}
    </Panel>
  );
}

function DefaultLimitsForm({ initial, onSaved }: { initial: LimitDefaults; onSaved: () => void }) {
  const [analysis, setAnalysis] = useState(String(initial.analysis_limit));
  const [chat, setChat] = useState(String(initial.chat_limit));
  const [saved, setSaved] = useState(false);
  const { run, submitting, error, setError } = useAction();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    const analysisLimit = Number(analysis);
    const chatLimit = Number(chat);
    const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_LIMIT;
    if (analysis.trim() === "" || chat.trim() === "" || !valid(analysisLimit) || !valid(chatLimit)) {
      setError("Enter whole numbers, zero or more.");
      return;
    }
    void run(async () => {
      await apiFetch("/admin/limit-defaults", {
        method: "PUT",
        body: JSON.stringify({ analysis_limit: analysisLimit, chat_limit: chatLimit }),
      });
      setSaved(true);
      onSaved();
    });
  }

  return (
    <Box component="form" noValidate onSubmit={handleSubmit} sx={{ display: "grid", gap: 1.5 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
        {(
          [
            ["Analysis runs", analysis, setAnalysis],
            ["Chat messages", chat, setChat],
          ] as const
        ).map(([label, value, set]) => (
          <TextField
            key={label}
            label={label}
            type="number"
            value={value}
            onChange={(e) => set(e.target.value)}
            slotProps={{ htmlInput: { min: 0 } }}
          />
        ))}
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Button type="submit" variant="contained" disabled={submitting}>
          Save defaults
        </Button>
        {saved && <Typography color="text.secondary">Saved</Typography>}
      </Box>
    </Box>
  );
}
