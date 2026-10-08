"use client";

import { useState } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { Check } from "lucide-react";
import { isinShape, setIsin } from "@/lib/orders";
import type { PlanLine } from "@/lib/plans";
import { useAction } from "@/lib/useAction";

const SHAPE_ERROR = "An ISIN is 12 characters: two letters, nine letters or digits, then a digit.";
const label = { fontSize: 12, color: "var(--muted)", minWidth: 40 } as const;
const rowSx = { display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", minHeight: 36 } as const;

/**
 * The ISIN of an opened line, or "None saved" with Add ISIN. The field checks the shape here, the server
 * checks the check digit (its 422 shows under the field), and `onChanged` reloads the plan so the ticket
 * includes the ISIN.
 */
export function IsinRow({ line, onChanged }: { line: PlanLine; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const action = useAction();

  if (!editing) {
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
            {saved && (
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: 12, color: "var(--up)", bgcolor: "var(--up-bg)", px: 1, py: 0.25, borderRadius: 999 }}>
                <Check size={13} aria-hidden />
                ISIN saved
              </Box>
            )}
          </>
        ) : (
          <>
            <Box component="span" sx={{ color: "var(--muted)" }}>
              None saved
            </Box>
            <Button variant="text" size="small" onClick={() => setEditing(true)} sx={{ minHeight: 44, textDecoration: "underline" }}>
              Add ISIN
            </Button>
          </>
        )}
      </Box>
    );
  }

  function submit() {
    const isin = isinShape(value);
    if (isin === null) {
      action.setError(SHAPE_ERROR);
      return;
    }
    void action.run(async () => {
      await setIsin(line.ticker, isin);
      await onChanged();
      setEditing(false);
      setSaved(true);
    });
  }

  // FastAPI prefixes a validator's message with "Value error, ".
  const error = action.error?.replace(/^Value error, /, "") ?? null;
  const length = value.trim().length;

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
          input: {
            endAdornment: (
              <Typography component="span" sx={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                {length} of 12
              </Typography>
            ),
          },
        }}
      />
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button type="submit" variant="contained" size="small" disabled={action.submitting} sx={{ minHeight: 44 }}>
          Save ISIN
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={{ minHeight: 44 }}
          onClick={() => {
            setEditing(false);
            setValue("");
            action.setError(null);
          }}
        >
          Cancel
        </Button>
      </Box>
    </Box>
  );
}
