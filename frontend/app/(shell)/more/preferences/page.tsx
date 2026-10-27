"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { AlertTriangle, Check, Plus } from "lucide-react";
import { Alert, Box, Button, Chip, InputAdornment, SvgIcon, TextField, Typography } from "@mui/material";
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
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const RISKS: RiskTolerance[] = ["conservative", "moderate", "aggressive"];

// A full-width control with equal segments, the words capitalised (the stored values are lower case).
const WIDE = { width: "100%", "& > *": { flex: 1 }, "& button": { textTransform: "capitalize" } } as const;

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
  // Baseline of the plan fields: captured at mount and after each save, never the live SWR value,
  // so a revalidation from another tab cannot turn an untouched field into a change.
  const [plan, setPlan] = useState({ amount: initial.monthly_contribution, drift: initial.drift_threshold_pct });
  const [amount, setAmount] = useState(amountText(initial));
  const [drift, setDrift] = useState(String(initial.drift_threshold_pct));
  const [amountError, setAmountError] = useState(false);
  const [driftError, setDriftError] = useState(false);
  const [saved, setSaved] = useState(false);
  const { run, submitting, error } = useAction();

  // Compared as numbers so "1200.50" is not a change from a saved 1200.5.
  const amountValue = parseContribution(amount);
  const driftValue = parseDrift(drift);
  const amountChanged = amountValue !== plan.amount;
  const driftChanged = driftValue !== plan.drift;

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
    setAmount(plan.amount === null ? "" : String(plan.amount));
    setDrift(String(plan.drift));
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
      setPlan({ amount: amountValue, drift: driftValue });
      setSaved(true);
    });
  }

  return (
    <Box>
      <PageHeader
        title="Preferences"
        subtitle="Preferences shape the explanations and the web second opinion. They never change the score or the call."
      />

      <Box sx={{ maxWidth: 760, display: "grid", gap: 2 }}>
        <Section title="Risk tolerance" hint="How bold explanations may be about position size.">
          <SegmentedControl
            label="Risk tolerance"
            // No risk chosen yet (null) leaves every segment off.
            value={risk ?? ("" as RiskTolerance)}
            onChange={(k) => setRisk(k === risk ? null : k)}
            segments={RISKS.map((r) => ({ key: r, label: r }))}
            sx={WIDE}
          />
        </Section>

        <Section title="Sectors to avoid">
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {sectors.map((s) => (
              <Chip
                key={s}
                label={s}
                sx={{ height: { xs: 44, md: 36 }, bgcolor: "var(--track)", color: "var(--text)", fontSize: "0.8125rem", fontWeight: 500, "& .MuiChip-deleteIcon": { color: "var(--muted)" } }}
                onDelete={() => setSectors((l) => l.filter((x) => x !== s))}
                deleteIcon={
                  <SvgIcon aria-label={`Remove ${s}`} titleAccess={`Remove ${s}`} role="button">
                    <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
                  </SvgIcon>
                }
              />
            ))}
          </Box>
          <Box sx={{ display: "flex", gap: 1.25, alignItems: "flex-start" }}>
            <TextField
              label="Add a sector"
              sx={{ flex: 1, minWidth: 0 }}
              value={sectorInput}
              onChange={(e) => setSectorInput(e.target.value)}
              slotProps={{ htmlInput: { maxLength: SECTOR_MAX_LENGTH } }}
              helperText={sectors.length >= MAX_SECTORS ? `At most ${MAX_SECTORS} sectors.` : undefined}
            />
            <Button
              variant="outlined"
              startIcon={<Plus size={16} aria-hidden />}
              sx={{ mt: "26px" }}
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
            slotProps={{
              htmlInput: { maxLength: NOTES_MAX, "aria-label": "Notes" },
              formHelperText: { sx: { textAlign: "right", fontVariantNumeric: "tabular-nums" } },
            }}
          />
        </Section>

        <Section
          title="Contribution plan"
          hint="Your monthly amount prefills the Plan page. Drift is how far a holding may sit from its target weight before Today flags it."
        >
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            <TextField
              id="pref-contribution"
              label="Monthly contribution"
              value={amount}
              error={amountError}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountError(false);
              }}
              helperText={amountError ? CONTRIBUTION_ERROR : "EUR, 0.01 to 1,000,000. Leave empty for none."}
              slotProps={{
                inputLabel: { shrink: true },
                formHelperText: { role: amountError ? "alert" : undefined },
                htmlInput: { inputMode: "decimal" },
                input: { endAdornment: <InputAdornment position="end">EUR</InputAdornment> },
              }}
              sx={{ width: { xs: "100%", sm: 260 } }}
            />
            <TextField
              id="pref-drift"
              label="Drift threshold"
              value={drift}
              error={driftError}
              onChange={(e) => {
                setDrift(e.target.value);
                setDriftError(false);
              }}
              helperText={driftError ? DRIFT_ERROR : "Percentage points, 1 to 50. Default 5."}
              slotProps={{
                inputLabel: { shrink: true },
                formHelperText: { role: driftError ? "alert" : undefined },
                htmlInput: { inputMode: "decimal" },
                input: { endAdornment: <InputAdornment position="end">pp</InputAdornment> },
              }}
              sx={{ width: { xs: "100%", sm: 260 } }}
            />
          </Box>
        </Section>

        <Section title="Appearance">
          <AppearanceSetting />
        </Section>

        <Panel sx={{ p: "20px 24px" }}>
          <AutoAnalysisSwitch saved={initial} onSaved={onSaved} />
        </Panel>
        <Panel sx={{ p: "20px 24px" }}>
          <AutoAnalysisSwitch saved={initial} onSaved={onSaved} kind="discovery" />
        </Panel>

        {error && <Alert severity="error">{error}</Alert>}
        <Panel
          sx={{
            position: "sticky",
            bottom: { xs: 76, md: 24 },
            p: "12px 16px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 1.5,
            bgcolor: "var(--tab-bg)",
          }}
        >
          {/* On a phone the status takes its own line above two equal buttons, and no line when there is no status. */}
          <Box sx={{ flex: { xs: "1 1 100%", sm: 1 }, display: dirty || saved ? "block" : { xs: "none", sm: "block" } }}>
            {dirty ? (
              <Pill tone="warn">
                <AlertTriangle size={13} aria-hidden />
                Unsaved changes
              </Pill>
            ) : (
              saved && (
                <Typography sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "0.8125rem", color: "var(--text2)" }}>
                  <Check size={16} color="var(--accent)" aria-hidden />
                  Saved
                </Typography>
              )
            )}
          </Box>
          <Button variant="outlined" disabled={!dirty || submitting} onClick={discard} sx={{ flex: { xs: 1, sm: "none" } }}>
            Discard
          </Button>
          <Button variant="contained" disabled={submitting} onClick={save} sx={{ whiteSpace: "nowrap", flex: { xs: 1, sm: "none" } }}>
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
        <Typography variant="subtitle2" component="h2" sx={{ fontSize: "0.9375rem" }}>
          {title}
        </Typography>
        {hint && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.5, mt: 0.25 }}>{hint}</Typography>}
      </Box>
      {children}
    </Panel>
  );
}
