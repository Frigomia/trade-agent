import { Box, Typography } from "@mui/material";
import { Globe } from "lucide-react";
import { Markdown } from "@/components/ui/Markdown";

// The mockups' `.web`: dashed always means web-derived and not part of the score.
export function WebOpinionBox({ text, article = false }: { text: string; article?: boolean }) {
  return (
    <Box
      sx={{
        mt: article ? 2.5 : 1.5,
        p: article ? "20px 26px" : "9px 11px",
        border: "1px dashed var(--line2)",
        borderRadius: article ? "16px" : "12px",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Globe size={15} color="var(--muted)" />
        <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
          Web second opinion &middot; not part of the score
        </Typography>
      </Box>
      <Box sx={{ mt: article ? 1.5 : 0.5 }}>
        <Markdown size={article ? 14.5 : 12.5}>{text}</Markdown>
      </Box>
    </Box>
  );
}
