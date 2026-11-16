import { Box, Typography } from "@mui/material";
import { CircleCheck, CircleHelp, Layers, Sparkles } from "lucide-react";
import { Meter } from "@/components/ui/Meter";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { cardFilterLine, filterRows } from "@/lib/etfIdea";
import { clampLines, confidenceLabel, fitScore, meterFill } from "@/lib/discovery";
import { Chip } from "./IdeaChips";

/**
 * What an ETF Today card shows under the fund's name (the approved "direction A" card): the gap
 * score, confidence and category as chips, the AI headline in its dashed box, and the one-line
 * quality filter result. Returns the rows without a wrapper so the card's own grid spaces them.
 */
export function EtfCardBody({ idea }: { idea: IdeaOut }) {
  const gap = fitScore(idea);
  const category = idea.snapshot?.industry;
  const unknown = filterRows(idea).some((row) => row.state === "unknown");
  return (
    <>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        {gap !== null && (
          <Chip>
            <Box component="span" aria-hidden sx={{ width: 40, height: 6, borderRadius: 999, bgcolor: "var(--line2)", position: "relative", overflow: "hidden" }}>
              <Box component="i" sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, Math.max(0, gap))}%`, bgcolor: "var(--accent)" }} />
            </Box>
            <span>
              Gap score <b style={{ color: "var(--text)", fontWeight: 650 }}>{gap}</b>
            </span>
          </Chip>
        )}
        <Chip>
          <Meter fill={meterFill(idea.confidence)} label={confidenceLabel(idea.confidence)} />
        </Chip>
        {category && (
          <Chip>
            <Layers size={13} aria-hidden />
            {category}
          </Chip>
        )}
      </Box>
      <Box sx={{ border: "1px dashed var(--line2)", borderRadius: "14px", p: "10px 12px", minWidth: 0 }}>
        <Typography sx={{ fontSize: "0.875rem", lineHeight: 1.55, color: "var(--text)", overflowWrap: "break-word", ...clampLines(3) }}>
          {idea.headline?.trim() || idea.thesis}
        </Typography>
        <Typography sx={{ mt: 0.75, display: "flex", alignItems: "center", gap: 0.75, fontSize: "0.75rem", color: "var(--muted)" }}>
          <Sparkles size={13} color="var(--accent)" aria-hidden />
          AI headline
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: "0.75rem", color: "var(--text2)" }}>
        {unknown ? (
          <CircleHelp size={16} aria-hidden style={{ flex: "none" }} />
        ) : (
          <CircleCheck size={16} fill="currentColor" stroke="var(--panel)" aria-hidden style={{ flex: "none" }} />
        )}
        <span style={{ minWidth: 0, overflowWrap: "break-word" }}>{cardFilterLine(idea)}</span>
      </Box>
    </>
  );
}
