"use client";

import { TextField, type TextFieldProps } from "@mui/material";
import { percentTextToFraction, TARGET_ERROR } from "@/lib/targetWeight";

type Props = { value: string; onChange: (text: string) => void } & Pick<TextFieldProps, "size" | "margin" | "fullWidth" | "sx">;

/** Percent text field (0 to 100); the parent converts with `percentTextToFraction`. */
export function TargetWeightField({ value, onChange, ...rest }: Props) {
  const invalid = percentTextToFraction(value) === undefined;
  return (
    <TextField
      label="Target weight (%)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={invalid}
      helperText={invalid ? TARGET_ERROR : undefined}
      slotProps={{ htmlInput: { inputMode: "decimal" } }}
      {...rest}
    />
  );
}
