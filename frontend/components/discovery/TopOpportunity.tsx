import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { ArrowRight, Sparkles } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import { clampLines, listingText } from "@/lib/discovery";
import { IdeaChips } from "./IdeaChips";
import { PriceBlock } from "./PriceBlock";
import { SaveToDiscover } from "./SaveToDiscover";

/**
 * The highest-ranked idea. The AI text sits in the dashed box apart from the computed numbers,
 * with the risk to the thesis next to it at equal weight.
 */
export function TopOpportunity({ rec, earlier = false }: { rec: DiscoveryRecommendation; earlier?: boolean }) {
  const idea = rec.idea!;
  const why = idea.catalysts.map((c) => typeof c === "string" ? c : c.text).find((c) => c.trim());
  const headline = idea.headline?.trim() || idea.thesis;
  return (
    <Box
      component="article"
      aria-label={`Top opportunity: ${idea.name}`}
      sx={{
        borderRadius: "22px",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow)",
        p: { xs: 2, md: 3 },
        background: "color-mix(in srgb, var(--accent) 8%, var(--panel))",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: 2,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
        <Logo ticker={idea.ticker} name={idea.name} size={56} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography component="h3" sx={{ fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.02em" }}>
            {idea.name}
          </Typography>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)" }}>{listingText(idea)}</Typography>
          {earlier && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 500 }}>From an earlier scan</Typography>}
        </Box>
        <PriceBlock rec={rec} large />
      </Box>
      <IdeaChips idea={idea} />
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: { xs: "wrap", md: "nowrap" } }}>
        <Box sx={{ flex: { xs: "1 1 100%", md: 1 }, minWidth: 0, border: "1px dashed var(--line2)", borderRadius: "14px", p: "14px 16px" }}>
          <Typography sx={{ fontSize: "0.9375rem", lineHeight: 1.55, ...clampLines(3) }}>{headline}</Typography>
          {why && (
            <Box sx={{ display: "flex", gap: 1, mt: 1, fontSize: "0.8125rem", color: "var(--text2)" }}>
              <Sparkles size={15} color="var(--accent)" aria-hidden style={{ flex: "none", marginTop: 2 }} />
              <Box component="span" sx={clampLines(2)}>
                <b>Why now.</b> {why}
              </Box>
            </Box>
          )}
          {idea.bear_case.trim() && (
            <Typography sx={{ mt: 1, fontSize: "0.8125rem", color: "var(--text2)", ...clampLines(2) }}>
              <b>Risk to the thesis.</b> {idea.bear_case}
            </Typography>
          )}
          <Typography sx={{ mt: 1.25, fontSize: "0.75rem", color: "var(--muted)" }}>
            AI research summary · {idea.sources.length} cited source{idea.sources.length === 1 ? "" : "s"}
          </Typography>
        </Box>
        <Box sx={{ display: "grid", justifyItems: "center", gap: 0.75, flex: "none", mx: { xs: "auto", md: 0 } }}>
          <Box
            component={Link}
            href={`/today/${rec.id}`}
            aria-label={`Open the full analysis of ${idea.name}`}
            sx={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              bgcolor: "var(--accent-solid)",
              color: "var(--on-accent) !important",
              boxShadow: "var(--btn-shadow)",
            }}
          >
            <ArrowRight size={22} aria-hidden />
          </Box>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Full analysis</Typography>
        </Box>
      </Box>
      <Box>
        <SaveToDiscover idea={idea} />
      </Box>
    </Box>
  );
}
