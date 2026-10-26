"use client";

import { Box, Button, Typography } from "@mui/material";
import { Panel } from "@/components/ui/Panel";

/** First-time entry opens the same drawer used for every other holding. */
export function FirstHolding({ onAdd }: { onAdd: () => void }) {
  return (
    <Panel sx={{ p: 3 }}>
      <Typography component="h2" sx={{ fontSize: "1.625rem", fontWeight: 650, letterSpacing: "-0.03em" }}>
        What do you own?
      </Typography>
      <Typography sx={{ color: "var(--muted)", mt: 0.75, mb: 2 }}>
        Start with a ticker and your shares. Fractional shares are welcome. Purchase details can wait.
      </Typography>
      <Button variant="contained" onClick={onAdd}>Add your first holding</Button>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", mt: 1.5 }}>
        A record of what you own. Nothing is bought or sold.
      </Typography>
      <Box component="ol" sx={{ color: "var(--muted)", fontSize: "0.75rem", mt: 2 }}>
        <li>Add holdings</li><li>Run a scan on Today</li><li>Decide</li>
      </Box>
    </Panel>
  );
}
