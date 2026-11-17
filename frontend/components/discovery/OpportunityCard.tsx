import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import { clampLines, listingText } from "@/lib/discovery";
import { etfListing, isEtf, shortFundName } from "@/lib/etfIdea";
import { EtfCardBody } from "./EtfCardBody";
import { IdeaChips } from "./IdeaChips";
import { PriceBlock } from "./PriceBlock";
import { SaveToDiscover } from "./SaveToDiscover";

/** One of the other ranked ideas: identity, price, meters, one line of reasoning and the two actions. */
export function OpportunityCard({ rec, earlier = false }: { rec: DiscoveryRecommendation; earlier?: boolean }) {
  const idea = rec.idea!;
  const etf = isEtf(idea);
  return (
    <Panel component="article" aria-label={idea.name} sx={{ p: { xs: 2, md: 2.5 }, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 1.5, alignContent: "start", minWidth: 0 }}>
      <Box
        sx={{
          display: "grid",
          // A fund's longer name is squeezed to a letter a line beside its quote in a narrow column, so an ETF's quote keeps its own row until xl.
          gridTemplateColumns: etf ? { xs: "auto minmax(0, 1fr)", xl: "auto minmax(0, 1fr) auto" } : { xs: "auto minmax(0, 1fr)", sm: "auto minmax(0, 1fr) auto" },
          alignItems: "center",
          columnGap: 1.5,
          rowGap: 1,
          minWidth: 0,
        }}
      >
        <Logo ticker={idea.ticker} name={idea.name} size={40} />
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h3" sx={{ fontSize: "0.9375rem", fontWeight: 650, overflowWrap: "break-word" }}>
            {etf ? shortFundName(idea.name) : idea.name}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", overflowWrap: "break-word" }}>{etf ? etfListing(idea) : listingText(idea)}</Typography>
          {earlier && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 500 }}>From an earlier scan</Typography>}
        </Box>
        <PriceBlock
          rec={rec}
          sx={etf ? { gridColumn: { xs: "1 / -1", xl: "auto" }, justifyItems: { xs: "start", xl: "end" }, textAlign: { xs: "left", xl: "right" } } : { gridColumn: { xs: "1 / -1", sm: "auto" } }}
        />
      </Box>
      {etf ? (
        <EtfCardBody idea={idea} />
      ) : (
        <>
          <IdeaChips idea={idea} />
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)", lineHeight: 1.5, overflowWrap: "break-word", ...clampLines(3) }}>
            {idea.headline?.trim() || idea.thesis}
          </Typography>
        </>
      )}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, minWidth: 0 }}>
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
        <SaveToDiscover idea={idea} label="Save" />
      </Box>
    </Panel>
  );
}
