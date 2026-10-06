"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Skeleton, Typography } from "@mui/material";
import { Panel } from "@/components/ui/Panel";
import { useClaudeKey } from "@/lib/claudeKey";
import { useAction } from "@/lib/useAction";

const GUIDE = "/more/connect-claude";
const STEP_KEY = `${GUIDE}?step=5`;

const CHIP = {
  ok: { label: "Connected", color: "var(--up)", bg: "var(--up-bg)" },
  warn: { label: "Needs attention", color: "var(--warn)", bg: "var(--warn-bg)" },
  none: { label: "Not connected", color: "var(--muted)", bg: "transparent" },
} as const;

/** The Account "Claude" panel: connection state, replace/reconnect, and removing the key. */
export function ClaudeKeyPanel() {
  const { status, error, isLoading, remove, refresh } = useClaudeKey();
  const { run, submitting, error: removeError, setError } = useAction();
  const [confirming, setConfirming] = useState(false);

  function close() {
    setConfirming(false);
    setError(null);
  }

  const kind = !status?.connected ? "none" : status.needs_attention ? "warn" : "ok";
  const chip = CHIP[kind];

  return (
    <Panel sx={{ p: "16px 18px", display: "grid", gap: 1.5 }} aria-busy={isLoading}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography component="h2" sx={{ fontSize: 16, fontWeight: 650 }}>
          Claude
        </Typography>
        {status && (
          <Chip
            size="small"
            label={chip.label}
            variant="outlined"
            sx={{ color: chip.color, borderColor: chip.color, bgcolor: chip.bg, fontWeight: 600 }}
          />
        )}
      </Box>

      {!status && error && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>Could not load your Claude status.</Typography>
          <Button size="small" startIcon={<RefreshCw size={14} />} onClick={() => void refresh()}>
            Try again
          </Button>
        </Box>
      )}
      {!status && !error && <Skeleton variant="rounded" height={36} />}

      {status && kind === "none" && (
        <>
          <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>
            Connect your own Claude account to use Chat and Run analysis.
          </Typography>
          <Box>
            <Button component={Link} href={GUIDE} variant="contained" size="small">
              Connect Claude
            </Button>
          </Box>
        </>
      )}

      {status && kind !== "none" && (
        <>
          {kind === "warn" && (
            <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>
              Anthropic did not accept your key. It may have been revoked, or the account may be out of credit. Chat and
              Run analysis are paused.
            </Typography>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Box
              component="span"
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}
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
            <Typography sx={{ fontSize: 12.5, color: "var(--muted)" }}>
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
            Chat and Run analysis stop working until you connect a key again. Your portfolio, watchlist and past
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
