"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Alert, Box, Button, Chip, InputAdornment, SvgIcon, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import { AppearanceSetting } from "@/components/settings/AppearanceSetting";
import { AutoAnalysisSwitch } from "@/components/settings/AutoAnalysisSwitch";
import {
  addSector,
  CONTRIBUTION_ERROR,
  DRIFT_ERROR,
  MAX_SECTORS,
  NOTES_MAX,
  parseContribution,
  parseDrift,
  SECTOR_MAX_LENGTH,
  type Preferences,
  type RiskTolerance,
} from "@/lib/preferences";
import { useAction } from "@/lib/useAction";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";

const RISKS: RiskTolerance[] = ["conservative", "moderate", "aggressive"];

const amountText = (p: Preferences) => (p.monthly_contribution === null ? "" : String(p.monthly_contribution));

export default function PreferencesPage() {
  const { data, error, mutate } = useSWR<Preferences>("/preferences", apiFetch);
  if (error) return <Alert severity="error">Could not load your preferences.</Alert>;
  if (!data) return null;
  return <PreferencesForm initial={data} onSaved={() => mutate()} />;
}

function PreferencesForm({ initial, onSaved }: { initial: Preferences; onSaved: () => unknown }) {
  const [risk, setRisk] = useState<RiskTolerance | null>(initial.risk_tolerance);
  const [sectors, setSectors] = useState<string[]>(initial.sector_avoid_list);
  const [sectorInput, setSectorInput] = useState("");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [amount, setAmount] = useState(amountText(initial));
  const [drift, setDrift] = useState(String(initial.drift_threshold_pct));
  const [amountError, setAmountError] = useState(false);
  const [driftError, setDriftError] = useState(false);
  const [saved, setSaved] = useState(false);
  const { run, submitting, error } = useAction();

  // Compared as numbers so "1200.50" is not a change from a saved 1200.5.
  const amountValue = parseContribution(amount);
  const driftValue = parseDrift(drift);
  const amountChanged = amountValue !== initial.monthly_contribution;
  const driftChanged = driftValue !== initial.drift_threshold_pct;

  const dirty =
    amountChanged ||
    driftChanged ||
    risk !== initial.risk_tolerance ||
    notes !== (initial.notes ?? "") ||
    sectors.join() !== initial.sector_avoid_list.join();

  function discard() {
    setRisk(initial.risk_tolerance);
    setSectors(initial.sector_avoid_list);
    setNotes(initial.notes ?? "");
    setSectorInput("");
    setAmount(amountText(initial));
    setDrift(String(initial.drift_threshold_pct));
    setAmountError(false);
    setDriftError(false);
    setSaved(false);
  }

  function save() {
    setSaved(false);
    setAmountError(amountValue === "invalid");
    setDriftError(driftValue === "invalid");
    if (amountValue === "invalid" || driftValue === "invalid") return;
    // The server applies only the fields sent: the plan fields go out only when they changed.
    // An empty amount is an explicit null (clear); the threshold is never null.
    const body: Record<string, unknown> = { risk_tolerance: risk, sector_avoid_list: sectors, notes: notes || null };
    if (amountChanged) body.monthly_contribution = amountValue;
    if (driftChanged) body.drift_threshold_pct = driftValue;
    return run(async () => {
      await apiFetch("/preferences", { method: "POST", body: JSON.stringify(body) });
      onSaved();
      setSaved(true);
    });
  }

  return (
    <Box>
      <PageHeader
        title="Preferences"
        subtitle="Preferences shape the explanations and the web second opinion. They never change the score or the call."
      />

      <Box sx={{ maxWidth: 680, display: "grid", gap: 1.75 }}>
        <Section title="Risk tolerance" hint="How bold explanations may be about position size.">
          <ToggleButtonGroup
            exclusive
            value={risk}
            onChange={(_, v: RiskTolerance | null) => setRisk(v)}
            aria-label="Risk tolerance"
          >
            {RISKS.map((r) => (
              <ToggleButton key={r} value={r} sx={{ textTransform: "capitalize" }}>
                {r}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Section>

        <Section title="Sectors to avoid">
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {sectors.map((s) => (
              <Chip
                key={s}
                label={s}
                onDelete={() => setSectors((l) => l.filter((x) => x !== s))}
                deleteIcon={
                  <SvgIcon aria-label={`Remove ${s}`} titleAccess={`Remove ${s}`} role="button">
                    <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
                  </SvgIcon>
                }
              />
            ))}
          </Box>
          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField
              label="Add a sector"
              size="small"
              value={sectorInput}
              onChange={(e) => setSectorInput(e.target.value)}
              slotProps={{ htmlInput: { maxLength: SECTOR_MAX_LENGTH } }}
              helperText={sectors.length >= MAX_SECTORS ? `At most ${MAX_SECTORS} sectors.` : undefined}
            />
            <Button
              disabled={sectors.length >= MAX_SECTORS}
              onClick={() => {
                setSectors((l) => addSector(l, sectorInput));
                setSectorInput("");
              }}
            >
              Add
            </Button>
          </Box>
        </Section>

        <Section title="Notes">
          <TextField
            multiline
            minRows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
            helperText={`${notes.length} / ${NOTES_MAX}`}
            slotProps={{ htmlInput: { maxLength: NOTES_MAX, "aria-label": "Notes" } }}
          />
        </Section>

        <Section
          title="Contribution plan"
          hint="Your monthly amount prefills the Plan page. Drift is how far a holding may sit from its target weight before Today flags it."
        >
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            <TextField
              label="Monthly contribution"
              size="small"
              value={amount}
              error={amountError}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountError(false);
              }}
              helperText={amountError ? CONTRIBUTION_ERROR : "EUR, 1 to 1,000,000. Leave empty for none."}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { inputMode: "decimal" },
                input: { endAdornment: <InputAdornment position="end">EUR</InputAdornment> },
              }}
              sx={{ width: 260 }}
            />
            <TextField
              label="Drift threshold"
              size="small"
              value={drift}
              error={driftError}
              onChange={(e) => {
                setDrift(e.target.value);
                setDriftError(false);
              }}
              helperText={driftError ? DRIFT_ERROR : "Percentage points, 1 to 50. Default 5."}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { inputMode: "decimal" },
                input: { endAdornment: <InputAdornment position="end">pp</InputAdornment> },
              }}
              sx={{ width: 260 }}
            />
          </Box>
        </Section>

        <Section title="Appearance">
          <AppearanceSetting />
        </Section>

        <Panel sx={{ p: "20px 24px" }}>
          <AutoAnalysisSwitch saved={initial} onSaved={onSaved} />
        </Panel>

        {error && <Alert severity="error">{error}</Alert>}
        <Panel
          sx={{
            position: "sticky",
            bottom: { xs: 76, md: 24 },
            p: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            bgcolor: "var(--tab-bg)",
            backdropFilter: "blur(18px)",
          }}
        >
          <Box sx={{ flex: 1 }}>
            {dirty ? (
              <Pill tone="warn">Unsaved changes</Pill>
            ) : (
              saved && <Typography color="text.secondary">Saved</Typography>
            )}
          </Box>
          <Button variant="outlined" disabled={!dirty || submitting} onClick={discard}>
            Discard
          </Button>
          <Button variant="contained" disabled={submitting} onClick={save} sx={{ whiteSpace: "nowrap" }}>
            Save preferences
          </Button>
        </Panel>
      </Box>
    </Box>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Panel sx={{ p: "20px 24px", display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box>
        <Typography variant="subtitle2" component="h2" sx={{ fontSize: 16 }}>
          {title}
        </Typography>
        {hint && <Typography sx={{ fontSize: 12.5, color: "var(--muted)" }}>{hint}</Typography>}
      </Box>
      {children}
    </Panel>
  );
}
