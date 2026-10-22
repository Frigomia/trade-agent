import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { ChevronRight, Eye } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import type { WatchlistInsight } from "@/lib/api/insight-types";
import { priceText } from "@/lib/priceRange";
import { insightsMissingNote } from "@/lib/useInsights";

/**
 * The Watchlist insights panel: a row per watched company whose price sits inside the range the
 * person set, with the sentence, the price against the range and a way into the watchlist. The pill
 * is neutral: being in a range is a fact about the person's own target, not a price move.
 */
export function WatchlistInsights({ insights, missing = [] }: { insights: WatchlistInsight[]; missing?: "prices"[] }) {
  const note = insightsMissingNote(missing);
  return (
    <Panel component="section" aria-label="Watchlist insights" sx={{ p: "18px 20px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Eye size={16} aria-hidden />
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
          Watchlist insights
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{insights.length} to look at</Typography>
      </Box>
      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, mt: 1 }}>
        {insights.map((insight) => (
          <Box component="li" key={insight.ticker} sx={{ borderBottom: "1px solid var(--line)", "&:last-of-type": { borderBottom: 0 } }}>
            <Box
              component={Link}
              href="/portfolio"
              sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.25, minHeight: 56, color: "inherit", textDecoration: "none" }}
            >
              <Logo ticker={insight.ticker} name={insight.ticker} size={34} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 650, fontSize: "0.8125rem" }}>{insight.ticker}</Typography>
                <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)" }}>{insight.text}</Typography>
                <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                  {priceText(insight.current_price)} · range {priceText(insight.target_price_low)} to {priceText(insight.target_price_high)}
                </Typography>
              </Box>
              <Box
                component="span"
                sx={{ flex: "none", px: 1.5, minHeight: 28, display: "inline-flex", alignItems: "center", borderRadius: 999, border: "1px solid var(--line2)", fontSize: "0.75rem", fontWeight: 500, whiteSpace: "nowrap" }}
              >
                In range
              </Box>
              <ChevronRight size={16} color="var(--muted)" aria-hidden />
            </Box>
          </Box>
        ))}
      </Box>
      {note && <Typography sx={{ mt: 1, fontSize: "0.75rem", color: "var(--muted)" }}>{note}</Typography>}
    </Panel>
  );
}
