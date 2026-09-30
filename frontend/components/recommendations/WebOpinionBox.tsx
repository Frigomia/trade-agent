import { Box, Typography } from "@mui/material";
import { Globe } from "lucide-react";

export function WebOpinionBox({ text }: { text: string }) {
  return (
    <Box
      sx={{
        mt: 1.5,
        p: 1.5,
        border: "1px dashed var(--line2)",
        borderRadius: 1.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Globe size={15} color="var(--muted)" />
        <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
          Web second opinion &middot; not part of the score
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 13, mt: 0.5 }}>{text}</Typography>
    </Box>
  );
}
