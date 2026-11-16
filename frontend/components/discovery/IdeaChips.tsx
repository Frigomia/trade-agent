import type { ReactNode } from "react";
import { Box } from "@mui/material";
import { Globe } from "lucide-react";
import { Meter } from "@/components/ui/Meter";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { confidenceLabel, etfFacts, meterFill, riskLabel, sectorText } from "@/lib/discovery";
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

// Country and sector describe the company; they are not signals, so they are plain text, not pills.
const fact = { display: "inline-flex", alignItems: "flex-start", gap: 0.75, minWidth: 0, fontSize: "0.75rem", color: "var(--muted)", "& svg": { flex: "none", mt: "2px" } } as const;

/** Confidence and risk as two pills (the signals), then the listing country and sector as quiet text when saved. */
export function IdeaChips({ idea }: { idea: IdeaOut }) {
  const country = idea.snapshot?.country;
  const sector = sectorText(idea);
  // A fund has no company sector: its cost, size and category take that line.
  const etf = idea.asset_type === "ETF" ? etfFacts(idea).filter((f) => f.value) : [];
  return (
    <Box sx={{ display: "grid", gap: 1, minWidth: 0 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        <Chip>
          <Meter fill={meterFill(idea.confidence)} label={confidenceLabel(idea.confidence)} />
        </Chip>
        <Chip>
          <Meter fill={meterFill(idea.risk.risk_level)} label={riskLabel(idea.risk.risk_level)} />
        </Chip>
      </Box>
      {etf.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 2, rowGap: 0.5 }}>
          {etf.map((f) => (
            <Box component="span" key={f.label} sx={fact}>
              {f.label === "Category" ? f.value : `${f.label} ${f.value}`}
            </Box>
          ))}
        </Box>
      )}
      {(country || sector) && (
        <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 2, rowGap: 0.5 }}>
          {country && (
            <Box component="span" sx={fact}>
              <Globe size={13} aria-hidden />
              {country}
            </Box>
          )}
          {sector && (
            <Box component="span" sx={fact}>
              <SectorIcon sector={idea.snapshot?.sector} size={13} />
              {sector}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
