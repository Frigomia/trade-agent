import type { ReactNode } from "react";
import { Box } from "@mui/material";
import { Globe } from "lucide-react";
import { Meter } from "@/components/ui/Meter";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { confidenceLabel, meterFill, riskLabel, sectorText } from "@/lib/discovery";
import { SectorIcon } from "@/components/ui/SectorIcon";

function Chip({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        px: 1.25,
        minHeight: 28,
        borderRadius: 999,
        bgcolor: "var(--track)",
        color: "var(--text2)",
        fontSize: "0.75rem",
        fontWeight: 500,
      }}
    >
      {children}
    </Box>
  );
}

/** Confidence and risk as meters with words, then the listing country and sector when saved. */
export function IdeaChips({ idea }: { idea: IdeaOut }) {
  const country = idea.snapshot?.country;
  const sector = sectorText(idea);
  return (
    <Box sx={{ display: "grid", gap: 1.25, minWidth: 0 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        <Chip>
          <Meter fill={meterFill(idea.confidence)} label={confidenceLabel(idea.confidence)} />
        </Chip>
        <Chip>
          <Meter fill={meterFill(idea.risk.risk_level)} label={riskLabel(idea.risk.risk_level)} />
        </Chip>
      </Box>
      {(country || sector) && (
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 2, rowGap: 0.75, color: "var(--muted)" }}>
          {country && (
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem" }}>
              <Globe size={13} aria-hidden />
              {country}
            </Box>
          )}
          {sector && (
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem", minWidth: 0 }}>
              <SectorIcon sector={idea.snapshot?.sector} size={13} />
              <Box component="span" sx={{ overflowWrap: "anywhere" }}>{sector}</Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
