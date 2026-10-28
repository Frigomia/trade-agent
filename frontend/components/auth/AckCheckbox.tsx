import { Box, Checkbox, FormControlLabel } from "@mui/material";
import { Check } from "lucide-react";

const BOX = {
  width: 22,
  height: 22,
  borderRadius: "7px",
  display: "grid",
  placeItems: "center",
  boxSizing: "border-box",
} as const;

/**
 * The acknowledgement tick on Set your password: a 22px Soft box inside a 44px target. The tick is
 * drawn in the on-accent colour so it reads on the pale dark-mode accent too.
 */
export function AckCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <FormControlLabel
      sx={{
        alignItems: "flex-start",
        m: 0,
        gap: 0.5,
        "& .MuiFormControlLabel-label": { fontSize: "0.75rem", color: "var(--text2)", lineHeight: 1.5, pt: "13px" },
      }}
      control={
        <Checkbox
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          sx={{ p: "11px", ml: "-11px", "&.Mui-focusVisible": { outline: "2px solid var(--accent)", outlineOffset: -4 } }}
          icon={<Box sx={{ ...BOX, border: "1.5px solid var(--muted)", bgcolor: "var(--panel)" }} />}
          checkedIcon={
            <Box sx={{ ...BOX, border: "1.5px solid var(--accent-solid)", bgcolor: "var(--accent-solid)", color: "var(--on-accent)" }}>
              <Check size={14} strokeWidth={3} aria-hidden />
            </Box>
          }
        />
      }
      label={label}
    />
  );
}
