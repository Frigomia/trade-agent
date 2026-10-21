import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { Bell, ChevronRight } from "lucide-react";
import type { RecommendationOut } from "@/lib/api/recommendation-types";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import { AutomaticTag } from "./AutomaticTag";

/**
 * What each pending call on a holding is, as the mock's alert pill. Only a new AI recommendation
 * exists today; earnings dates and moves since purchase need a backend source first.
 */
function InsightPill() {
  return (
    <Box
      component="span"
      sx={{ flex: "none", px: 1.5, minHeight: 28, display: "inline-flex", alignItems: "center", borderRadius: 999, border: "1px solid var(--line2)", fontSize: "0.75rem", fontWeight: 500, whiteSpace: "nowrap" }}
    >
      New insight
    </Box>
  );
}

/** The desktop panel of pending calls on holdings: a row per call that opens its analysis. */
export function PortfolioAlerts({ recommendations }: { recommendations: RecommendationOut[] }) {
  return (
    <Panel sx={{ p: "18px 20px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Bell size={16} aria-hidden />
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
          Portfolio alerts
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{recommendations.length} pending</Typography>
      </Box>
      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, mt: 1 }}>
        {recommendations.map((rec) => (
          <Box component="li" key={rec.id} sx={{ borderBottom: "1px solid var(--line)", "&:last-of-type": { borderBottom: 0 } }}>
            <Box
              component={Link}
              href={`/today/${rec.id}`}
              sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.25, minHeight: 56, color: "inherit", textDecoration: "none" }}
            >
              <Logo name={rec.ticker} size={34} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1 }}>
                  <Typography sx={{ fontWeight: 650, fontSize: "0.8125rem" }}>{rec.ticker}</Typography>
                  <AutomaticTag source={rec.source} />
                </Box>
                <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)" }}>New AI recommendation: {rec.action}</Typography>
              </Box>
              <InsightPill />
              <ChevronRight size={16} color="var(--muted)" aria-hidden />
            </Box>
          </Box>
        ))}
      </Box>
    </Panel>
  );
}
