import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
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
      aria-label={"Top opportunity: " + idea.name}
      sx={{
        borderRadius: "22px",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow)",
        p: { xs: 2, md: 3 },
        bgcolor: "var(--panel)",
        display: "grid",
        gap: 2,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, alignItems: { xs: "stretch", sm: "center" }, gap: 1.5, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0, flex: 1 }}>
          <Logo ticker={idea.ticker} name={idea.name} size={48} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="h3" sx={{ fontSize: { xs: "1.125rem", md: "1.25rem" }, fontWeight: 650, letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>
              {idea.name}
            </Typography>
            <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)", overflowWrap: "anywhere" }}>{listingText(idea)}</Typography>
            {earlier && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 500 }}>From an earlier scan</Typography>}
          </Box>
        </Box>
        <Box sx={{ alignSelf: { xs: "flex-start", sm: "center" }, minWidth: 0 }}>
          <PriceBlock rec={rec} large />
        </Box>
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: "0.75rem", fontWeight: 650, color: "var(--muted)", mb: 1 }}>
          RESEARCH SIGNALS
        </Typography>
        <IdeaChips idea={idea} />
      </Box>

      <Box sx={{ bgcolor: "var(--track)", borderRadius: "14px", p: { xs: 1.75, md: 2 }, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
          <Sparkles size={15} color="var(--accent)" aria-hidden />
          <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text2)" }}>AI research summary</Typography>
        </Box>
        <Typography sx={{ fontSize: "0.9375rem", lineHeight: 1.55, overflowWrap: "anywhere", ...clampLines(4) }}>
          {headline}
        </Typography>
        {why && (
          <Typography sx={{ mt: 1.25, fontSize: "0.8125rem", color: "var(--text2)", overflowWrap: "anywhere", ...clampLines(3) }}>
            <b>Why now.</b> {why}
          </Typography>
        )}
        {idea.bear_case.trim() && (
          <Typography sx={{ mt: 1, fontSize: "0.8125rem", color: "var(--text2)", overflowWrap: "anywhere", ...clampLines(3) }}>
            <b>Risk to the thesis.</b> {idea.bear_case}
          </Typography>
        )}
        <Typography sx={{ mt: 1.5, fontSize: "0.75rem", color: "var(--muted)" }}>
          {idea.sources.length} cited source{idea.sources.length === 1 ? "" : "s"} · AI-generated, not a recommendation
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1.25, minWidth: 0 }}>
        <Button
          component={Link}
          href={"/today/" + rec.id}
          variant="contained"
          endIcon={<ArrowRight size={16} aria-hidden />}
          aria-label={"Open the full analysis of " + idea.name}
          sx={{ minHeight: 44, borderRadius: "14px", flex: { xs: "1 1 100%", sm: "0 1 auto" } }}
        >
          View research
        </Button>
        <SaveToDiscover idea={idea} />
      </Box>
    </Box>
  );
}
