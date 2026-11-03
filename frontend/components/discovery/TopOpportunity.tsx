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
 * with the risk to the thesis next to it at equal weight. On a phone the quote sits under the
 * company and the Go button shares a row with Save, so no row is crowded.
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
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "auto minmax(0, 1fr)", sm: "auto minmax(0, 1fr) auto" },
          alignItems: "center",
          columnGap: { xs: 1.5, md: 2 },
          rowGap: 1.5,
          minWidth: 0,
        }}
      >
        <Logo ticker={idea.ticker} name={idea.name} size={56} />
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h3" sx={{ fontSize: { xs: "1.125rem", md: "1.25rem" }, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.25, overflowWrap: "break-word" }}>
            {idea.name}
          </Typography>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)", overflowWrap: "break-word" }}>{listingText(idea)}</Typography>
          {earlier && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 500 }}>From an earlier scan</Typography>}
        </Box>
        <PriceBlock rec={rec} large sx={{ gridColumn: { xs: "1 / -1", sm: "auto" } }} />
      </Box>
      <IdeaChips idea={idea} />
      <Box
        sx={{
          // A phone wraps: the dashed box, then the Go button and Save on one row, Save dropping under it when too narrow.
          display: { xs: "flex", md: "grid" },
          flexWrap: "wrap",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gridTemplateAreas: '"box go" "save ."',
          alignItems: "center",
          columnGap: 2,
          rowGap: { xs: 1.5, md: 2 },
        }}
      >
        <Box sx={{ gridArea: "box", flex: { xs: "1 1 100%", md: "none" }, minWidth: 0, border: "1px dashed var(--line2)", borderRadius: "14px", p: { xs: "12px 14px", md: "14px 16px" } }}>
          <Typography sx={{ fontSize: "0.9375rem", lineHeight: 1.55, overflowWrap: "break-word", ...clampLines(3) }}>{headline}</Typography>
          {why && (
            <Box sx={{ display: "flex", gap: 1, mt: 1, fontSize: "0.8125rem", color: "var(--text2)" }}>
              <Sparkles size={15} color="var(--accent)" aria-hidden style={{ flex: "none", marginTop: 2 }} />
              <Box component="span" sx={{ minWidth: 0, overflowWrap: "break-word", ...clampLines(2) }}>
                <b>Why now.</b> {why}
              </Box>
            </Box>
          )}
          {idea.bear_case.trim() && (
            <Typography sx={{ mt: 1, fontSize: "0.8125rem", color: "var(--text2)", overflowWrap: "break-word", ...clampLines(2) }}>
              <b>Risk to the thesis.</b> {idea.bear_case}
            </Typography>
          )}
          <Typography sx={{ mt: 1.25, fontSize: "0.75rem", color: "var(--muted)" }}>
            AI research summary · {idea.sources.length} cited source{idea.sources.length === 1 ? "" : "s"}
          </Typography>
        </Box>
        <Box sx={{ gridArea: "go", display: "flex", flexDirection: { xs: "row", md: "column" }, alignItems: "center", gap: { xs: 1.25, md: 0.75 } }}>
          <Box
            component={Link}
            href={`/today/${rec.id}`}
            aria-label={`Open the full analysis of ${idea.name}`}
            sx={{
              width: { xs: 48, md: 56 },
              height: { xs: 48, md: 56 },
              flex: "none",
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
        <Box sx={{ gridArea: "save", ml: { xs: "auto", md: 0 }, justifySelf: "start", "& .MuiButton-root": { whiteSpace: "nowrap" } }}>
          <SaveToDiscover idea={idea} />
        </Box>
      </Box>
    </Box>
  );
}
