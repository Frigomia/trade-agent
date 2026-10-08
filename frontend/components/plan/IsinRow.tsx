"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { Check } from "lucide-react";
import { isinShape, setIsin } from "@/lib/orders";
import type { PlanLine } from "@/lib/plans";
import { useAction } from "@/lib/useAction";

const SHAPE_ERROR = "An ISIN is 12 characters: two letters, nine letters or digits, then a digit.";
const label = { fontSize: 12, color: "var(--muted)", minWidth: 40 } as const;
const rowSx = { display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", minHeight: 36 } as const;
const linkButton = { minHeight: 44, textDecoration: "underline" } as const;

type Mode = "view" | "edit" | "remove";

/**
 * The ISIN of an opened line: "None saved" with Add ISIN, or the ISIN with Change and Remove. The field
 * checks the shape here, the server checks the check digit (its 422 shows under the field), and
 * `onChanged` reloads the plan so the ticket follows. Back in the row, the focus goes to its button.
 */
export function IsinRow({ line, onChanged }: { line: PlanLine; onChanged: () => Promise<unknown> }) {
  const [mode, setMode] = useState<Mode>("view");
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const rowRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  // After Save, Cancel or Remove the form is gone; put the focus back on the row (its Add ISIN or
  // Change button, else the row itself) instead of letting it fall to the page.
  useEffect(() => {
    if (mode !== "view" || !refocus.current) return;
    refocus.current = false;
    (buttonRef.current ?? rowRef.current)?.focus();
  }, [mode, line.isin]);

  function backToRow() {
    refocus.current = true;
    setMode("view");
    setValue("");
    action.setError(null);
  }

  function startEdit() {
    setSaved(false);
    setValue(line.isin ?? "");
    action.setError(null);
    setMode("edit");
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
      backToRow();
      setSaved(true);
    });
  }

  function remove() {
    void action.run(async () => {
      await setIsin(line.ticker, null);
      await onChanged();
      backToRow();
      setSaved(false);
    });
  }

  if (mode === "remove") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={rowSx}>
          <Box component="span" sx={{ fontWeight: 500 }}>
            Remove ISIN?
          </Box>
          <Button variant="contained" size="small" onClick={remove} disabled={action.submitting} sx={{ minHeight: 44 }}>
            Remove
          </Button>
          <Button variant="outlined" size="small" onClick={backToRow} disabled={action.submitting} sx={{ minHeight: 44 }}>
            Cancel
          </Button>
        </Box>
        {action.error && (
          <Typography role="alert" sx={{ fontSize: 13, color: "var(--down)" }}>
            {action.error}
          </Typography>
        )}
      </Box>
    );
  }

  if (mode === "view") {
    return (
      <Box ref={rowRef} tabIndex={-1} sx={{ ...rowSx, "&:focus": { outline: "none" } }}>
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
            <Button ref={buttonRef} variant="text" size="small" onClick={startEdit} sx={linkButton}>
              Change
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setSaved(false);
                action.setError(null);
                setMode("remove");
              }}
              sx={linkButton}
            >
              Remove
            </Button>
          </>
        ) : (
          <>
            <Box component="span" sx={{ color: "var(--muted)" }}>
              None saved
            </Box>
            <Button ref={buttonRef} variant="text" size="small" onClick={startEdit} sx={linkButton}>
              Add ISIN
            </Button>
          </>
        )}
      </Box>
    );
  }

  const error = action.error;
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
        <Button variant="outlined" size="small" sx={{ minHeight: 44 }} onClick={backToRow}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
}
