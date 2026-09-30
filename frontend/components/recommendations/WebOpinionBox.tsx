import { Box, Typography } from "@mui/material";
import { Globe } from "lucide-react";

// The mockups' `.web`: dashed always means web-derived and not part of the score.
export function WebOpinionBox({ text }: { text: string }) {
  return (
    <Box
      sx={{
        mt: 1.5,
        p: "9px 11px",
        border: "1px dashed var(--line2)",
        borderRadius: "12px",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Globe size={15} color="var(--muted)" />
        <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
          Web second opinion &middot; not part of the score
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 12.5, color: "var(--text2)", mt: 0.5, lineHeight: 1.5 }}>
        {text}
      </Typography>
    </Box>
  );
}
