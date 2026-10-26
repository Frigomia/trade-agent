import { Box } from "@mui/material";

/** One short segment per line of a plan, filled for each placed one: the plan's progress at a glance. */
export function PlacedProgress({ placed }: { placed: boolean[] }) {
  return (
    <Box component="span" aria-hidden data-testid="progress" sx={{ display: "inline-flex", gap: 0.5 }}>
      {placed.map((done, i) => (
        <Box
          component="i"
          key={i}
          data-placed={done}
          sx={{ width: 28, height: 4, borderRadius: 999, bgcolor: done ? "var(--accent-solid)" : "var(--track)" }}
        />
      ))}
    </Box>
  );
}
