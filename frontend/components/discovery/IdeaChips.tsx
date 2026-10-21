import type { ReactNode } from "react";
import { Box } from "@mui/material";
import { Globe, Layers } from "lucide-react";
import { Meter } from "@/components/ui/Meter";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { confidenceLabel, meterFill, riskLabel, sectorText } from "@/lib/discovery";

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
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      <Chip>
        <Meter fill={meterFill(idea.confidence)} label={confidenceLabel(idea.confidence)} />
      </Chip>
      <Chip>
        <Meter fill={meterFill(idea.risk.risk_level)} label={riskLabel(idea.risk.risk_level)} />
      </Chip>
      {country && (
        <Chip>
          <Globe size={13} aria-hidden />
          {country}
        </Chip>
      )}
      {sector && (
        <Chip>
          <Layers size={13} aria-hidden />
          {sector}
        </Chip>
      )}
    </Box>
  );
}
