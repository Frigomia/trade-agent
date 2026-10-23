"use client";

import { Box, Button, Typography } from "@mui/material";
import { ChevronRight } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import type { HoldingSummary } from "@/lib/api/portfolio-types";

/**
 * Holdings that were sold out (0 shares). They have no row in "Your holdings", so this is where a re-buy
 * (or a purchase that was never logged) can still be logged; a sale is refused by the backend, which has
 * no shares to sell. A native disclosure: closed until asked for.
 */
export function ClosedPositions({
  holdings,
  onLogTrade,
  onRemove,
}: {
  holdings: HoldingSummary[];
  onLogTrade: (holding: HoldingSummary) => void;
  onRemove: (holding: HoldingSummary) => void;
}) {
  if (holdings.length === 0) return null;
  return (
    <Panel component="section" aria-label="Closed positions" sx={{ p: "4px 18px", mt: 2 }}>
      <Box
        component="details"
        sx={{
          "& > summary": { display: "flex", alignItems: "center", gap: 1, minHeight: 44, cursor: "pointer", listStyle: "none", "&::-webkit-details-marker": { display: "none" } },
          "&[open] > summary svg": { transform: "rotate(90deg)" },
        }}
      >
        <summary>
          <ChevronRight size={16} aria-hidden style={{ transition: "transform 120ms" }} />
          <Typography component="span" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
            Closed positions
          </Typography>
          <Typography component="span" sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            ({holdings.length})
          </Typography>
        </summary>
        <Box component="ul" role="list" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {holdings.map((h) => (
            <Box
              component="li"
              key={h.ticker}
              sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1, borderTop: "1px solid var(--line)", flexWrap: "wrap" }}
            >
              <Logo ticker={h.ticker} name={h.name} size={34} />
              <Box sx={{ flex: 1, minWidth: 120 }}>
                <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{h.ticker}</Typography>
                <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", overflowWrap: "anywhere" }}>{h.name} · Closed</Typography>
              </Box>
              <Button variant="outlined" size="small" onClick={() => onLogTrade(h)} aria-label={`Log a trade for ${h.ticker}`} sx={{ minHeight: { xs: 44, md: 36 } }}>
                Log a trade
              </Button>
              <Button size="small" onClick={() => onRemove(h)} aria-label={`Remove ${h.ticker}`} sx={{ minHeight: { xs: 44, md: 36 }, color: "var(--text2)" }}>
                Remove
              </Button>
            </Box>
          ))}
        </Box>
      </Box>
    </Panel>
  );
}
