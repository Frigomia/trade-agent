import { Box } from "@mui/material";
import { Clock } from "lucide-react";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

// Marks a call that came from the scheduled run. A manual one (or an older payload with no
// `source`) shows nothing.
export function AutomaticTag({ source }: { source?: RecommendationOut["source"] }) {
  if (source !== "scheduled") return null;
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        px: "9px",
        py: "3px",
        borderRadius: "999px",
        fontSize: 11,
        fontWeight: 500,
        border: "1px solid var(--line2)",
        color: "var(--text2)",
      }}
    >
      <Clock size={12} aria-hidden />
      Automatic
    </Box>
  );
}
