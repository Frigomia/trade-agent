"use client";

import { useState } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { setIsin } from "@/lib/orders";
import type { PlanLine } from "@/lib/plans";
import { useAction } from "@/lib/useAction";

const label = { fontSize: 12, color: "var(--muted)", minWidth: 40 } as const;
const rowSx = { display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", minHeight: 36 } as const;
const linkButton = { minHeight: 44, textDecoration: "underline" } as const;

type Mode = "view" | "edit";

/**
 * The ISIN of an opened line: "None saved" with Add ISIN, or the ISIN with Change and Remove. The
 * server checks the ISIN (its 422 shows under the field), and `onChanged` reloads the plan so the
 * ticket follows. Back in the row, the focus goes to its button (it mounts with autoFocus).
 */
export function IsinRow({ line, onChanged }: { line: PlanLine; onChanged: () => Promise<unknown> }) {
  const [mode, setMode] = useState<Mode>("view");
  const [value, setValue] = useState("");
  const [returned, setReturned] = useState(false); // the form was left: focus the row's button
  const action = useAction();

  function backToRow() {
    setReturned(true);
    setMode("view");
    setValue("");
    action.setError(null);
  }

  function startEdit() {
    setReturned(false);
    setValue(line.isin ?? "");
    action.setError(null);
    setMode("edit");
  }

  function submit() {
    const isin = value.trim();
    if (isin === "") {
      action.setError("Enter an ISIN");
      return;
    }
    void action.run(async () => {
      await setIsin(line.ticker, isin);
      await onChanged();
      backToRow();
    });
  }

  function remove() {
    void action.run(async () => {
      await setIsin(line.ticker, null);
      setReturned(true); // the Change button is about to become Add ISIN: focus that one
      await onChanged();
    });
  }

  if (mode === "view") {
    return (
      <Box sx={rowSx}>
        <Box component="span" sx={label}>
          ISIN
        </Box>
        {line.isin ? (
          <>
            <Box component="span" sx={{ fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>
              {line.isin}
            </Box>
            <Button key="change" autoFocus={returned} variant="text" size="small" onClick={startEdit} sx={linkButton}>
              Change
            </Button>
            <Button variant="text" size="small" onClick={remove} disabled={action.submitting} sx={linkButton}>
              Remove
            </Button>
          </>
        ) : (
          <>
            <Box component="span" sx={{ color: "var(--muted)" }}>
              None saved
            </Box>
            <Button key="add" autoFocus={returned} variant="text" size="small" onClick={startEdit} sx={linkButton}>
              Add ISIN
            </Button>
          </>
        )}
        {action.error && (
          <Typography role="alert" sx={{ fontSize: 13, color: "var(--down)", flexBasis: "100%" }}>
            {action.error}
          </Typography>
        )}
      </Box>
    );
  }

  const error = action.error;

  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}
    >
      <TextField
        label={`ISIN for ${line.ticker}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error !== null}
        helperText={error ?? `Found on your broker's page for the instrument. It is added to every ticket for ${line.ticker}.`}
        autoFocus
        size="small"
        slotProps={{
          htmlInput: { maxLength: 14, autoCapitalize: "characters", spellCheck: false, autoComplete: "off" },
        }}
      />
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button type="submit" variant="contained" size="small" disabled={action.submitting} sx={{ minHeight: 44 }}>
          Save ISIN
        </Button>
        <Button variant="outlined" size="small" sx={{ minHeight: 44 }} onClick={backToRow}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
}
