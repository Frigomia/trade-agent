import { Box, Typography } from "@mui/material";
import { Globe } from "lucide-react";
import { Markdown } from "@/components/ui/Markdown";

// The mockups' `.web`: dashed always means web-derived and not part of the score.
export function WebOpinionBox({
  text,
  article = false,
  label = "Web second opinion · not part of the score",
}: {
  text: string;
  article?: boolean;
  label?: string;
}) {
  return (
    <Box
      sx={{
        ...(article
          ? { mt: 2.5, p: "20px 26px", borderRadius: "16px" }
          : { mt: 1.5, p: "9px 11px", borderRadius: "12px" }),
        border: "1px dashed var(--line2)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Globe size={15} color="var(--muted)" />
        <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
          {label}
        </Typography>
      </Box>
      <Box sx={{ mt: article ? 1.5 : 0.5 }}>
        <Markdown size={article ? 14.5 : 12.5}>{text}</Markdown>
      </Box>
    </Box>
  );
}
