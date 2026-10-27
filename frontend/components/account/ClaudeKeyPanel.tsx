"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Skeleton, Typography } from "@mui/material";
import { ClaudeStateChip } from "@/components/claude/ClaudeStateChip";
import { Panel } from "@/components/ui/Panel";
import { apiFetch } from "@/lib/api/client";
import { useClaudeKey } from "@/lib/claudeKey";
import { useAction } from "@/lib/useAction";

const GUIDE = "/more/connect-claude";
const STEP_KEY = `${GUIDE}?step=5`;

/** The Account "Claude" panel: connection state, replace/reconnect, and removing the key. */
export function ClaudeKeyPanel() {
  const { status, error, remove, refresh } = useClaudeKey();
  const { run, submitting, error: removeError, setError } = useAction();
  const [confirming, setConfirming] = useState(false);
  // An admin without a personal key uses the server's key, so "Not connected" would be wrong for them:
  // the role is read only when it decides what to show, as the Chat lock does.
  const needsRole = status !== undefined && !status.connected;
  const { data: me, error: meError, mutate: refreshMe } = useSWR<{ role: string }>(needsRole ? "/me" : null, apiFetch);

  function close() {
    setConfirming(false);
    setError(null);
  }

  const failed = status === undefined ? Boolean(error) : needsRole && Boolean(meError);
  // Until the role is known an unconnected account could be either, so the panel waits rather than flash "Connect Claude".
  const ready = status !== undefined && (status.connected || me !== undefined);
  const kind = status?.connected ? (status.needs_attention ? "warn" : "ok") : me?.role === "admin" ? "server" : "none";

  return (
    <Panel sx={{ p: "18px 20px", display: "grid", gap: 1.5 }} aria-busy={!ready && !failed}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650 }}>
          Claude
        </Typography>
        {ready && <ClaudeStateChip kind={kind} />}
      </Box>

      {failed && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)" }}>Could not load your Claude status.</Typography>
          <Button size="small" startIcon={<RefreshCw size={14} />} onClick={() => void Promise.all([refresh(), refreshMe()])}>
            Try again
          </Button>
        </Box>
      )}
      {!ready && !failed && <Skeleton variant="rounded" height={36} />}

      {ready && kind === "server" && (
        <>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
            Chat and scans use the server&apos;s Claude key, so you do not need to connect your own.
          </Typography>
          <Box>
            <Button component={Link} href={GUIDE} variant="outlined" size="small">
              Connect your own key
            </Button>
          </Box>
        </>
      )}

      {ready && kind === "none" && (
        <>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
            Connect your own Claude account to use Chat and scans.
          </Typography>
          <Box>
            <Button component={Link} href={GUIDE} variant="contained" size="small">
              Connect Claude
            </Button>
          </Box>
        </>
      )}

      {ready && kind !== "none" && kind !== "server" && (
        <>
          {kind === "warn" && (
            <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
              Anthropic did not accept your key. It may have been revoked, or the account may be out of credit. Chat and
              scans are paused.
            </Typography>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Box
              component="span"
              sx={{ display: "inline-flex", alignItems: "center", gap: 1, minHeight: 36, px: 1.5, borderRadius: "14px", bgcolor: "var(--track)", fontFamily: "var(--font-mono, monospace)", fontSize: "0.8125rem" }}
            >
              <KeyRound size={16} color="var(--muted)" aria-hidden />
              {`sk-ant-…${status.last4 ?? ""}`}
            </Box>
            <Box sx={{ flex: 1 }} />
            <Button
              component={Link}
              href={STEP_KEY}
              size="small"
              variant={kind === "warn" ? "contained" : "outlined"}
            >
              {kind === "warn" ? "Reconnect" : "Replace"}
            </Button>
            <Button size="small" variant="outlined" startIcon={<Trash2 size={14} />} onClick={() => setConfirming(true)}>
              Remove
            </Button>
          </Box>
          {kind === "ok" && (
            <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.5 }}>
              Your key is stored encrypted and is never shown again; only the last four characters are.
            </Typography>
          )}
        </>
      )}

      <Dialog
        open={confirming}
        onClose={() => {
          if (!submitting) close();
        }}
        aria-labelledby="remove-claude-key-title"
        aria-describedby="remove-claude-key-text"
      >
        <DialogTitle id="remove-claude-key-title">Remove your Claude key?</DialogTitle>
        <DialogContent>
          <DialogContentText id="remove-claude-key-text">
            Chat and scans stop working until you connect a key again. Your portfolio, watchlist and past
            recommendations stay as they are.
          </DialogContentText>
          {removeError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {removeError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={close} disabled={submitting}>
            Keep it
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={submitting}
            onClick={() =>
              void run(async () => {
                await remove();
                setConfirming(false);
              })
            }
          >
            Remove key
          </Button>
        </DialogActions>
      </Dialog>
    </Panel>
  );
}
