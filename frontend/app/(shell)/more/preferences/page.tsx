"use client";

import { useState } from "react";
import useSWR from "swr";
import { Alert, Box, Button, Chip, SvgIcon, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import { AppearanceSetting } from "@/components/settings/AppearanceSetting";
import { addSector, NOTES_MAX, type Preferences, type RiskTolerance } from "@/lib/preferences";
import { useAction } from "@/lib/useAction";

const RISKS: RiskTolerance[] = ["conservative", "moderate", "aggressive"];

export default function PreferencesPage() {
  const { data, error, mutate } = useSWR<Preferences>("/preferences", apiFetch);
  if (error) return <Alert severity="error">Could not load your preferences.</Alert>;
  if (!data) return null;
  return <PreferencesForm initial={data} onSaved={() => mutate()} />;
}

function PreferencesForm({ initial, onSaved }: { initial: Preferences; onSaved: () => void }) {
  const [risk, setRisk] = useState<RiskTolerance | null>(initial.risk_tolerance);
  const [sectors, setSectors] = useState<string[]>(initial.sector_avoid_list);
  const [sectorInput, setSectorInput] = useState("");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [saved, setSaved] = useState(false);
  const { run, submitting, error } = useAction();

  function save() {
    setSaved(false);
    return run(async () => {
      await apiFetch("/preferences", {
        method: "POST",
        body: JSON.stringify({ risk_tolerance: risk, sector_avoid_list: sectors, notes: notes || null }),
      });
      onSaved();
      setSaved(true);
    });
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 560 }}>
      <Typography variant="h5" component="h1">
        Preferences
      </Typography>
      <Typography color="text.secondary">
        Preferences shape the explanations and the web second opinion. They never change the score or the call.
      </Typography>

      <Typography variant="subtitle2" component="h2">
        Risk tolerance
      </Typography>
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

      <Typography variant="subtitle2" component="h2">
        Sectors to avoid
      </Typography>
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
        />
        <Button
          onClick={() => {
            setSectors((l) => addSector(l, sectorInput));
            setSectorInput("");
          }}
        >
          Add
        </Button>
      </Box>

      <Typography variant="subtitle2" component="h2">
        Notes
      </Typography>
      <TextField
        label="Notes"
        multiline
        minRows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
        helperText={`${notes.length} / ${NOTES_MAX}`}
        slotProps={{ htmlInput: { maxLength: NOTES_MAX } }}
      />

      <Typography variant="subtitle2" component="h2">
        Appearance
      </Typography>
      <AppearanceSetting />

      {error && <Alert severity="error">{error}</Alert>}
      {saved && <Typography color="text.secondary">Saved</Typography>}
      <Box>
        <Button variant="contained" disabled={submitting} onClick={save}>
          Save preferences
        </Button>
      </Box>
    </Box>
  );
}
