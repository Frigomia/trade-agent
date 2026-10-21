import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import { clampLines, listingText } from "@/lib/discovery";
import { IdeaChips } from "./IdeaChips";
import { PriceBlock } from "./PriceBlock";
import { SaveToDiscover } from "./SaveToDiscover";

/** One of the other ranked ideas: identity, price, meters, one line of reasoning and the two actions. */
export function OpportunityCard({ rec, earlier = false }: { rec: DiscoveryRecommendation; earlier?: boolean }) {
  const idea = rec.idea!;
  return (
    <Panel component="article" aria-label={idea.name} sx={{ p: 2.5, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 1.5, alignContent: "start" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
        <Logo name={idea.name} size={40} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography component="h3" sx={{ fontSize: "0.9375rem", fontWeight: 650 }}>
            {idea.name}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{listingText(idea)}</Typography>
          {earlier && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 500 }}>From an earlier scan</Typography>}
        </Box>
        <PriceBlock rec={rec} />
      </Box>
      <IdeaChips idea={idea} />
      <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)", lineHeight: 1.5, ...clampLines(3) }}>
        {idea.headline?.trim() || idea.thesis}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Box
          component={Link}
          href={`/today/${rec.id}`}
          aria-label={`Open research on ${idea.name}`}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.5,
            minHeight: { xs: 44, md: 36 },
            fontSize: "0.8125rem",
            fontWeight: 500,
          }}
        >
          Open research <ArrowRight size={14} aria-hidden />
        </Box>
        <SaveToDiscover name={idea.name} label="Save" />
      </Box>
    </Panel>
  );
}
