"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  Skeleton,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { ClaudeStateChip } from "@/components/claude/ClaudeStateChip";
import { Panel } from "@/components/ui/Panel";
import { useTelegram, type TelegramPatch } from "@/lib/telegram";
import { useAction } from "@/lib/useAction";

const NOTE = "Messages list tickers and actions only, never amounts or reasoning. Advisory only.";
const PITCH = "Get a short message on weekday mornings when there is something to look at.";
const BLOCKED = "Telegram stopped receiving messages. Reconnect to get them again.";
const THRESHOLD_ERROR = "Enter a number from 1 to 50, one decimal at most.";
const NEW_TAB = "noopener,noreferrer";

const muted = { fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 } as const;
const linkSx = { color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "2px", overflowWrap: "anywhere" } as const;
const cardSx = { p: "18px 20px", display: "flex", flexDirection: "column", gap: 1.75, minWidth: 0 } as const;

/** One decimal, 1 to 50: the same bounds the backend enforces. */
function parseThreshold(raw: string): number | null {
  const text = raw.trim().replace(",", "."); // some decimal keypads show a comma
  if (!/^\d+(\.\d)?$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 50 ? n : null;
}

function Title({ focusable }: { focusable?: boolean }) {
  return (
    <Typography
      component="h2"
      tabIndex={focusable ? -1 : undefined}
      data-focus={focusable ? "" : undefined}
      sx={{ fontSize: 16, fontWeight: 650, outline: "none" }}
    >
      Telegram
    </Typography>
  );
}

/** Static sample of what a Telegram message looks like. No user data: nothing here is read from the API. */
function PreviewCard({ reminder }: { reminder: boolean }) {
  return (
    <Panel sx={cardSx}>
      <Typography
        component="h3"
        sx={{ fontSize: 11, fontWeight: 650, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)", minHeight: 26, display: "flex", alignItems: "center" }}
      >
        What a message looks like
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, maxWidth: 420 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>trade-agent bot</Typography>
        <Box
          sx={{
            bgcolor: "var(--up-bg)",
            border: "1px solid var(--line)",
            borderRadius: "6px 16px 16px 16px",
            p: "10px 12px",
            fontSize: 13.5,
            lineHeight: 1.55,
            color: "var(--text)",
            display: "grid",
            gap: 1.25, // the blank line between the message's sections
            whiteSpace: "pre-wrap", // keeps the two spaces after "Today:" and "Plan:" as sent
          }}
        >
          {/* Mirrors backend/app/notify.py build_message: sections, one item per line. */}
          <Box>
            <div>📋 3 new recommendations</div>
            <div>• AAPL  ADD</div>
            <div>• MSFT  HOLD</div>
            <div>• NVDA  TRIM</div>
          </Box>
          <Box>
            <div>📈 Moved</div>
            <div>• AAPL  ▼ 6.2%</div>
            <div>• NVDA  ▲ 5.4%</div>
          </Box>
          {reminder && <div>🗓 Time to plan this month&apos;s contribution.</div>}
          <Box>
            <div>
              Today:{"  "}
              <Box component="span" sx={linkSx}>https://app.example.com/today</Box>
            </div>
            {reminder && (
              <div>
                Plan:{"   "}
                <Box component="span" sx={linkSx}>https://app.example.com/portfolio/plan</Box>
              </div>
            )}
          </Box>
          <Box component="span" sx={{ color: "var(--muted)", fontSize: 12 }}>
            Advisory only. Nothing is sent to a broker.
          </Box>
        </Box>
        <Typography sx={{ fontSize: 11, color: "var(--muted)", alignSelf: "flex-end" }}>07:31</Typography>
      </Box>
    </Panel>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
      <Box>
        <Typography id={`${id}-label`} sx={{ fontSize: 14, fontWeight: 650 }}>
          {label}
        </Typography>
        <Typography id={`${id}-hint`} sx={muted}>
          {hint}
        </Typography>
      </Box>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={(_, next) => onChange(next)}
        slotProps={{ input: { "aria-labelledby": `${id}-label`, "aria-describedby": `${id}-hint` } }}
      />
    </Box>
  );
}

/** The Account "Telegram" panel: settings card beside a static preview of a message (design direction C). */
export function TelegramPanel() {
  const { status, error, isLoading, waiting, connect, cancel, update, disconnect, refresh } = useTelegram();
  const link = useAction();
  const save = useAction();
  const leave = useAction();
  // The one-time link lives only here, for "Open Telegram again"; never logged, stored or put in the address.
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<TelegramPatch>({});
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const linked = status?.linked === true;
  const blocked = linked && status?.status === "blocked";
  // A linked person keeps their settings and Disconnect even when the server lost its bot username.
  const canConnect = status?.configured === true;
  const state = !status ? "loading" : !canConnect && !linked ? "unavailable" : waiting ? "waiting" : blocked ? "blocked" : linked ? "connected" : "off";

  // Linked, cancelled or expired: forget the link (derived state, reset during render).
  const [wasWaiting, setWasWaiting] = useState(waiting);
  if (waiting !== wasWaiting) {
    setWasWaiting(waiting);
    if (!waiting) setUrl(null);
  }

  // Move focus to the new state's main element when the state changes (the old button unmounted).
  const previous = useRef(state);
  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    if (was !== state && ["off", "waiting", "connected", "blocked"].includes(was)) {
      // Only when focus was in the panel (or lost): a poll must not steal it from another field.
      const at = document.activeElement;
      if (!at || at === document.body || panelRef.current?.contains(at)) {
        panelRef.current?.querySelector<HTMLElement>("[data-focus]")?.focus();
      }
    }
  }, [state]);

  function startConnect() {
    void link.run(async () => {
      const { url: next } = await connect();
      setUrl(next);
      // Best effort: browsers may block a tab opened after an await. The result is unknowable
      // (noopener makes it null), so the waiting card always carries a real link too.
      window.open(next, "_blank", NEW_TAB);
    });
  }

  function patch(change: TelegramPatch, rollback: () => void) {
    return save.run(async () => {
      try {
        await update(change);
      } finally {
        rollback();
      }
    });
  }

  function toggle(key: "digest_enabled" | "moves_enabled" | "plan_reminder_enabled", next: boolean) {
    setPending((p) => ({ ...p, [key]: next }));
    void patch({ [key]: next }, () => setPending((p) => ({ ...p, [key]: undefined })));
  }

  function commitThreshold() {
    if (draft === null || !status) return;
    const value = parseThreshold(draft);
    if (value === null) {
      save.setError(THRESHOLD_ERROR);
      setDraft(null);
    } else if (value === status.move_threshold_pct) {
      setDraft(null);
    } else {
      void patch({ move_threshold_pct: value }, () => setDraft(null));
    }
  }

  if (!status) {
    return (
      <Panel sx={cardSx} aria-busy={isLoading}>
        <Title />
        {error ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography sx={{ fontSize: 13, color: "var(--muted)" }}>Could not load your Telegram status.</Typography>
            <Button size="small" startIcon={<RefreshCw size={14} />} onClick={() => void refresh()}>
              Try again
            </Button>
          </Box>
        ) : (
          <Skeleton variant="rounded" height={36} />
        )}
      </Panel>
    );
  }

  if (state === "unavailable") {
    return (
      <Panel sx={cardSx}>
        <Title />
        <Typography sx={muted}>Telegram is not available on this server.</Typography>
      </Panel>
    );
  }

  const thresholdInvalid = save.error === THRESHOLD_ERROR;
  const digestOn = pending.digest_enabled ?? status.digest_enabled;
  const movesOn = pending.moves_enabled ?? status.moves_enabled;
  const planOn = pending.plan_reminder_enabled ?? status.plan_reminder_enabled;

  return (
    <Box
      ref={panelRef}
      sx={{ display: "grid", gap: 2.25, alignItems: "stretch", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) 300px" } }}
    >
      <Panel sx={{ ...cardSx, order: { xs: 1, md: 0 } }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.25 }}>
          <Title focusable={state === "connected" || state === "blocked"} />
          <ClaudeStateChip kind={blocked ? "warn" : linked ? "ok" : "none"} />
        </Box>

        {state === "off" && (
          <>
            <Typography sx={{ fontSize: 13, color: "var(--text2)" }}>{PITCH}</Typography>
            <Box>
              <Button variant="contained" size="small" disabled={link.submitting} onClick={startConnect} data-focus="">
                Connect Telegram
              </Button>
            </Box>
            <Typography sx={{ ...muted, fontSize: 12 }}>{NOTE}</Typography>
          </>
        )}

        {state === "waiting" && (
          <>
            <Box role="status" tabIndex={-1} data-focus="" sx={{ display: "flex", alignItems: "center", gap: 1.25, outline: "none" }}>
              <Box component="span" aria-hidden sx={{ display: "inline-flex", gap: 0.5, "& i": { width: 6, height: 6, borderRadius: "50%", bgcolor: "var(--accent)" }, "& i:nth-of-type(2)": { opacity: 0.55 }, "& i:nth-of-type(3)": { opacity: 0.25 } }}>
                <i />
                <i />
                <i />
              </Box>
              <Typography sx={{ fontSize: 13, color: "var(--text2)" }}>Waiting for you to press Start in Telegram…</Typography>
            </Box>
            <Typography sx={muted}>The link works for 10 minutes.</Typography>
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
              {url && (
                <Button component="a" href={url} target="_blank" rel="noopener noreferrer" variant="outlined" size="small">
                  Open Telegram again
                </Button>
              )}
              <Button variant="outlined" size="small" onClick={() => { cancel(); setUrl(null); }}>
                Cancel
              </Button>
            </Box>
          </>
        )}

        {state === "connected" && (
          <>
            <SwitchRow
              id="tg-digest"
              label="Morning digest"
              hint="New recommendations from the automatic analysis."
              checked={digestOn}
              disabled={save.submitting}
              onChange={(next) => toggle("digest_enabled", next)}
            />
            <SwitchRow
              id="tg-moves"
              label="Price moves"
              hint="Tickers that moved at least the threshold since the previous close."
              checked={movesOn}
              disabled={save.submitting}
              onChange={(next) => toggle("moves_enabled", next)}
            />
            <SwitchRow
              id="tg-plan"
              label="Monthly plan reminder"
              hint="Sent on the first weekday of the month, only if at least one holding or watchlist item has a target weight."
              checked={planOn}
              disabled={save.submitting}
              onChange={(next) => toggle("plan_reminder_enabled", next)}
            />
            <TextField
              id="tg-threshold"
              label="Move threshold"
              size="small"
              disabled={save.submitting}
              error={thresholdInvalid}
              value={draft ?? String(status.move_threshold_pct)}
              helperText={thresholdInvalid ? THRESHOLD_ERROR : "1 to 50"}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitThreshold}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.querySelector("input")?.blur();
              }}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { inputMode: "decimal" },
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
              }}
              sx={{ width: 140 }}
            />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap" }}>
              <Typography sx={{ ...muted, fontSize: 12, flex: 1, minWidth: 200 }}>{NOTE}</Typography>
              <Button variant="outlined" size="small" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            </Box>
          </>
        )}

        {state === "blocked" && (
          <>
            <Box sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", color: "var(--warn)", fontSize: 12.5, lineHeight: 1.5 }}>
              <AlertTriangle size={16} aria-hidden style={{ marginTop: 1, flex: "none" }} />
              <span>{BLOCKED}</span>
            </Box>
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
              {canConnect && (
                <Button variant="contained" size="small" disabled={link.submitting} onClick={startConnect}>
                  Reconnect
                </Button>
              )}
              <Button variant="outlined" size="small" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            </Box>
          </>
        )}

        {link.error && <Alert severity="error">{link.error}</Alert>}
        {save.error && !thresholdInvalid && <Alert severity="error">{save.error}</Alert>}
      </Panel>

      <Box sx={{ order: { xs: 0, md: 1 }, display: "grid" }}>
        <PreviewCard reminder={planOn} />
      </Box>

      <Dialog
        open={confirming}
        onClose={() => {
          if (!leave.submitting) {
            setConfirming(false);
            leave.setError(null);
          }
        }}
        aria-labelledby="disconnect-telegram-title"
        aria-describedby="disconnect-telegram-text"
      >
        <DialogTitle id="disconnect-telegram-title">Disconnect Telegram?</DialogTitle>
        <DialogContent>
          <DialogContentText id="disconnect-telegram-text">
            You stop getting messages until you connect again. Your portfolio and recommendations are not affected.
          </DialogContentText>
          {leave.error && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {leave.error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            autoFocus
            disabled={leave.submitting}
            onClick={() => {
              setConfirming(false);
              leave.setError(null);
            }}
          >
            Keep connected
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={leave.submitting}
            onClick={() =>
              void leave.run(async () => {
                await disconnect();
                setConfirming(false);
              })
            }
          >
            Disconnect Telegram
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
