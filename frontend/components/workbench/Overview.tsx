"use client";

import { useState } from "react";
import { Box, Skeleton, Typography } from "@mui/material";
import { ChevronDown } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { useIdeaHistory } from "@/lib/useIdeaHistory";
import { BearCase, BODY, BullCase, H3 } from "./Cases";
import { PriceChart } from "./PriceChart";

/** The thesis: AI text in the dashed box, a few lines first and the whole text on request. */
function Thesis({ idea }: { idea: IdeaOut }) {
  const [open, setOpen] = useState(false);
  const long = idea.thesis.length > 320 || idea.outlook.trim().length > 0;
  return (
    <Panel component="section" sx={{ p: "20px", display: "grid", gap: 1.5 }}>
      <Typography component="h3" sx={H3}>
        Investment thesis
      </Typography>
      <Box sx={{ border: "1px dashed var(--line2)", borderRadius: "14px", p: "14px 16px", display: "grid", gap: 1 }}>
        <Typography
          sx={{
            fontSize: "0.9375rem",
            lineHeight: 1.55,
            color: "var(--text)",
            whiteSpace: "pre-line",
            ...(open ? {} : { display: "-webkit-box", WebkitLineClamp: 6, WebkitBoxOrient: "vertical", overflow: "hidden" }),
          }}
        >
          {idea.thesis}
        </Typography>
        {open && idea.outlook.trim() && <Typography sx={BODY}>{idea.outlook}</Typography>}
        {long && (
          <Box
            component="button"
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            sx={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 0.5, minHeight: { xs: 44, md: 32 }, p: 0, border: 0, bgcolor: "transparent", color: "var(--accent)", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}
          >
            {open ? "Show less" : "Read the full thesis"}
            <ChevronDown size={14} aria-hidden style={{ transform: open ? "rotate(180deg)" : "none" }} />
          </Box>
        )}
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          AI research summary · {idea.sources.length} cited source{idea.sources.length === 1 ? "" : "s"}
        </Typography>
      </Box>
    </Panel>
  );
}

/** The price chart with its range control; says so plainly when the history is not available. */
function ChartPanel({ recommendationId }: { recommendationId: number }) {
  const { range, setRange, history, unavailable, loading } = useIdeaHistory(recommendationId);
  return (
    <Panel component="section" sx={{ p: "20px", display: "grid", gap: 1.5 }}>
      <Typography component="h3" sx={H3}>
        Share price
      </Typography>
      {loading && !history ? (
        <Skeleton variant="rounded" height={220} sx={{ borderRadius: "14px" }} />
      ) : unavailable || !history || !Array.isArray(history.points) ? (
        <Typography sx={{ ...BODY, color: "var(--muted)", py: 3 }}>
          The price history is not available for this company right now. The price saved with the scan is shown at the top.
        </Typography>
      ) : (
        <PriceChart history={history} range={range} onRange={setRange} />
      )}
    </Panel>
  );
}

/** The Overview tab: thesis, price chart, then the bull and bear cases side by side. */
export function Overview({ idea, recommendationId }: { idea: IdeaOut; recommendationId: number }) {
  return (
    <Box sx={{ display: "grid", gap: 2, minWidth: 0 }}>
      <Thesis idea={idea} />
      <ChartPanel recommendationId={recommendationId} />
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" }, alignItems: "start" }}>
        <BullCase idea={idea} />
        <BearCase idea={idea} />
      </Box>
      {idea.fit_summary && (
        <Panel component="section" sx={{ p: "20px", display: "grid", gap: 1 }}>
          <Typography component="h3" sx={H3}>
            Fit with your portfolio
          </Typography>
          <Typography sx={BODY}>{idea.fit_summary}</Typography>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>AI research summary</Typography>
        </Panel>
      )}
    </Box>
  );
}
