import { Box } from "@mui/material";
import { monogram } from "@/lib/discovery";

/** A round monogram for a company. Never a brand mark: it carries identity without a logo file. */
export function Logo({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        bgcolor: "var(--track)",
        color: "var(--text2)",
        fontWeight: 650,
        fontSize: `${(size * 0.34) / 16}rem`,
      }}
    >
      {monogram(name)}
    </Box>
  );
}
