import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { Ring } from "@/components/ui/Ring";

/** Shown when no call has reached its 20th trading day yet, so there is nothing to score. */
export function TrackRecordEmpty() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", pt: 5, pb: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Ring size={132} tone="idle">
          <Box>
            <Typography sx={{ fontSize: 30, fontWeight: 650, letterSpacing: "-0.03em", lineHeight: 1 }}>20</Typography>
            <Typography sx={{ fontSize: 11, color: "var(--muted)", mt: 0.5 }}>trading days</Typography>
          </Box>
        </Ring>
      </Box>
      <Typography component="h2" sx={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em" }}>
        No scored calls yet
      </Typography>
      <Typography sx={{ fontSize: 13.5, color: "var(--muted)", mt: 0.75, mb: 2.5, maxWidth: 420 }}>
        A call is scored 20 trading days after it is made. Then you see how many moved the way the action implied.
      </Typography>
      <Button component={Link} href="/today" variant="outlined">
        See today&apos;s recommendations
      </Button>
      <Typography sx={{ fontSize: 12, color: "var(--muted)", mt: 2.5 }}>HOLD and WATCH aren&apos;t scored.</Typography>
    </Box>
  );
}
