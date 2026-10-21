import { Box } from "@mui/material";

/**
 * Confidence or risk as three bars plus the word, never colour alone and never green or red
 * (those mean a price moved). The bars are decoration; the word carries the meaning.
 */
export function Meter({ fill, label }: { fill: number; label: string }) {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      <Box component="span" aria-hidden sx={{ display: "inline-flex", gap: "2px" }}>
        {[1, 2, 3].map((n) => (
          <Box
            key={n}
            component="i"
            sx={{
              width: 8,
              height: 12,
              borderRadius: "2px",
              border: "1px solid",
              borderColor: n <= fill ? "var(--text2)" : "var(--line2)",
              bgcolor: n <= fill ? "var(--text2)" : "transparent",
            }}
          />
        ))}
      </Box>
      {label}
    </Box>
  );
}
