"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Button, Chip, TextField, Typography } from "@mui/material";
import { Check, ExternalLink, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { ApiError } from "@/lib/api/client";
import { useClaudeKey } from "@/lib/claudeKey";
import { useAction } from "@/lib/useAction";

const BASE = "/more/connect-claude";
const LAST_STEP = 5;

interface Step {
  title: string;
  text: string;
  link?: { label: string; href: string };
}

const STEPS: Step[] = [
  {
    title: "Create an Anthropic account",
    text: "Sign up at platform.claude.com with any email.",
    link: { label: "Open platform.claude.com", href: "https://platform.claude.com" },
  },
  {
    title: "Add a small amount of credit",
    text: "Under Billing, add credit. Claude is pay-as-you-go: you pay Anthropic only for what you use. Their pricing page has the current rates.",
    link: { label: "Open Billing", href: "https://platform.claude.com/settings/billing" },
  },
  {
    title: "Set a monthly spend limit",
    text: "In the billing settings, set a monthly spend limit so usage can never go past what you chose.",
    link: { label: "Open billing settings", href: "https://platform.claude.com/settings/billing" },
  },
  {
    title: "Create a key",
    text: "On the API keys page, create a key and name it trade-agent. Copy it straight away: Anthropic shows it only once.",
    link: { label: "Open API keys", href: "https://platform.claude.com/settings/keys" },
  },
  {
    title: "Paste it here",
    text: "Paste the key and press Check and save. We check it with Anthropic before keeping it.",
  },
];

const SAFE =
  "Stored encrypted. Used only for your own analyses and chat. You can remove it at any time. trade-agent never places trades.";
const REJECTED = "Anthropic did not accept this key. Check that you copied all of it, then try again.";

function clampStep(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(n) ? 1 : Math.min(LAST_STEP, Math.max(1, n));
}

const focusRing = { outline: "2px solid var(--accent)", outlineOffset: 2 } as const;

function RailItem({ n, current, step, onJump }: { n: number; current: number; step: Step; onJump: (n: number) => void }) {
  const done = n < current;
  const cur = n === current;
  const circle = (
    <Box
      component="span"
      sx={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        flex: "none",
        fontWeight: 650,
        fontSize: 13,
        border: "1px solid var(--line2)",
        color: "var(--muted)",
        ...(cur && { bgcolor: "var(--accent-solid)", color: "var(--on-accent)", borderColor: "transparent" }),
        ...(done && { bgcolor: "var(--up-bg)", color: "var(--accent)", borderColor: "transparent" }),
      }}
    >
      {done ? <Check size={15} data-testid="step-check" aria-hidden /> : n}
    </Box>
  );
  const sx = {
    all: "unset",
    boxSizing: "border-box",
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 1.5,
    px: 2,
    py: 1.25,
    fontSize: 13,
    color: cur ? "var(--text)" : done ? "var(--text2)" : "var(--muted)",
    fontWeight: cur ? 650 : 400,
  } as const;
  return (
    <Box component="li" sx={{ listStyle: "none" }}>
      {done ? (
        <Box
          component="button"
          type="button"
          onClick={() => onJump(n)}
          sx={{ ...sx, cursor: "pointer", "&:focus-visible": focusRing }}
        >
          {circle}
          {step.title}
        </Box>
      ) : (
        <Box aria-current={cur ? "step" : undefined} sx={sx}>
          {circle}
          {step.title}
        </Box>
      )}
    </Box>
  );
}

function KeyField({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const id = useId();
  // The pasted key lives only here; this component unmounts on save and on leaving step 5.
  const [apiKey, setApiKey] = useState("");
  const { save } = useClaudeKey();
  const { run, submitting, error, setError } = useAction();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      try {
        await save(apiKey);
      } catch (err) {
        if (err instanceof ApiError && err.code === "invalid_key") {
          setError(REJECTED);
          return;
        }
        throw err;
      }
      setApiKey("");
      onSaved();
    });
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ display: "grid", gap: 1.5 }}>
      <Box sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", flexWrap: "wrap" }}>
        <TextField
          id={id}
          label="Claude API key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-…"
          error={Boolean(error)}
          helperText={error}
          slotProps={{
            htmlInput: { autoComplete: "off", spellCheck: false },
            inputLabel: { shrink: true },
          }}
          sx={{ flex: 1, minWidth: 220 }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={apiKey.length === 0 || submitting}
          sx={{ mt: "23px", width: { xs: "100%", sm: "auto" } }}
        >
          {submitting ? "Checking with Anthropic…" : "Check and save"}
        </Button>
      </Box>
      <Box>
        <Button type="button" variant="outlined" size="small" onClick={onBack}>
          Back
        </Button>
      </Box>
    </Box>
  );
}

function Connected({ last4, onToday }: { last4: string | null | undefined; onToday: () => void }) {
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
        <Box
          sx={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            bgcolor: "var(--up-bg)",
            color: "var(--accent)",
            display: "grid",
            placeItems: "center",
            flex: "none",
          }}
        >
          <Check size={22} aria-hidden />
        </Box>
        <Box>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 650 }}>
            Claude is connected
          </Typography>
          <Typography sx={{ fontSize: 13.5, color: "var(--text2)", mt: 0.5 }}>
            Chat and Run analysis now use your own Claude account.
          </Typography>
        </Box>
      </Box>
      <Box
        sx={{
          p: "12px 14px",
          borderRadius: "13px",
          border: "1px solid var(--line2)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 1.25,
        }}
      >
        <Box component="span" sx={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>
          {`sk-ant-…${last4 ?? ""}`}
        </Box>
        <Chip
          label="Connected"
          size="small"
          icon={<Check size={13} aria-hidden />}
          sx={{ bgcolor: "var(--up-bg)", color: "var(--accent)", "& .MuiChip-icon": { color: "var(--accent)" } }}
        />
      </Box>
      <Box>
        <Button variant="contained" onClick={onToday}>
          Go to Today
        </Button>
      </Box>
    </Box>
  );
}

export function ConnectClaudeGuide() {
  const router = useRouter();
  const current = clampStep(useSearchParams().get("step"));
  const [saved, setSaved] = useState(false);
  const { status } = useClaudeKey();

  const go = (n: number) => router.replace(`${BASE}?step=${n}`);
  const step = STEPS[current - 1];

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: saved ? "1fr" : "230px 1fr" },
        gap: 2.5,
        maxWidth: 960,
        alignItems: "start",
      }}
    >
      {!saved && (
        <Panel
          component="nav"
          aria-label="Steps"
          sx={{ display: { xs: "none", md: "block" }, py: 1.25 }}
        >
          <Box component="ol" sx={{ m: 0, p: 0 }}>
            {STEPS.map((s, i) => (
              <RailItem key={s.title} n={i + 1} current={current} step={s} onJump={go} />
            ))}
          </Box>
        </Panel>
      )}
      <Box sx={{ display: "grid", gap: 2 }}>
        <Panel sx={{ p: { xs: "18px 16px", md: "24px 26px" }, display: "grid", gap: 1.75 }}>
          {saved ? (
            <Connected last4={status?.last4} onToday={() => router.push("/today")} />
          ) : (
            <>
              <Box aria-hidden sx={{ display: { xs: "flex", md: "none" }, gap: 0.75 }}>
                {STEPS.map((s, i) => (
                  <Box
                    key={s.title}
                    sx={{ width: 22, height: 4, borderRadius: 2, bgcolor: i < current ? "var(--accent)" : "var(--line2)" }}
                  />
                ))}
              </Box>
              <Typography
                aria-live="polite"
                sx={{ fontSize: 11, fontWeight: 650, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--accent)" }}
              >
                Step {current} of {LAST_STEP}
              </Typography>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 650 }}>
                {step.title}
              </Typography>
              <Typography sx={{ fontSize: 13.5, color: "var(--text2)", maxWidth: 520, lineHeight: 1.6 }}>
                {step.text}
              </Typography>
              {step.link && (
                <Box>
                  <Button
                    variant="outlined"
                    size="small"
                    href={step.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    endIcon={<ExternalLink size={15} aria-hidden />}
                  >
                    {step.link.label}
                  </Button>
                </Box>
              )}
              {current < LAST_STEP ? (
                <Box sx={{ display: "flex", gap: 1.25, flexWrap: "wrap", mt: 0.75 }}>
                  {current > 1 && (
                    <Button variant="outlined" size="small" onClick={() => go(current - 1)}>
                      Back
                    </Button>
                  )}
                  <Button variant="contained" size="small" onClick={() => go(current + 1)}>
                    I have the key, next
                  </Button>
                </Box>
              ) : (
                <KeyField onBack={() => go(current - 1)} onSaved={() => setSaved(true)} />
              )}
            </>
          )}
        </Panel>
        <Panel
          sx={{
            display: "flex",
            gap: 1.25,
            alignItems: "flex-start",
            p: "12px 14px",
            borderRadius: "14px",
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "var(--text2)",
            boxShadow: "none",
          }}
        >
          <ShieldCheck size={18} color="var(--accent)" aria-hidden style={{ flex: "none", marginTop: 1 }} />
          <span>{SAFE}</span>
        </Panel>
      </Box>
    </Box>
  );
}
