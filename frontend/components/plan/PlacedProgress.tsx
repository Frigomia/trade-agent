import { Box } from "@mui/material";

const SEGMENT = 28; // px at most; a segment may shrink to MIN
const MIN = 3;
const GAP = 4;
// Past this the strip would not fit a phone even at the minimum size: the count beside it says it all.
const MAX_SEGMENTS = 40;

/**
 * One short segment per line of a plan, filled for each placed one: the plan's progress at a glance.
 * The segments shrink so a long plan still fits the panel on a phone, and the strip never grows past
 * its container, so a count beside it stays in view. Its natural width is set (empty segments give a
 * flex container no intrinsic width of their own).
 */
export function PlacedProgress({ placed }: { placed: boolean[] }) {
  if (placed.length === 0 || placed.length > MAX_SEGMENTS) return null;
  return (
    <Box
      component="span"
      aria-hidden
      data-testid="progress"
      sx={{ display: "flex", gap: `${GAP}px`, width: `${placed.length * (SEGMENT + GAP) - GAP}px`, minWidth: 0, maxWidth: "100%", flex: "0 1 auto" }}
    >
      {placed.map((done, i) => (
        <Box
          component="i"
          key={i}
          data-placed={done}
          sx={{ flex: `0 1 ${SEGMENT}px`, minWidth: `${MIN}px`, height: 4, borderRadius: 999, bgcolor: done ? "var(--accent-solid)" : "var(--track)" }}
        />
      ))}
    </Box>
  );
}
