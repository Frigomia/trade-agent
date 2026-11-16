import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { Sparkles } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { calendarDateText } from "@/lib/discovery";
import { H3, SourceLink } from "./Cases";
import { EtfHero } from "./EtfHero";
import { EtfSideColumn } from "./EtfSideColumn";
import { SourcesTab } from "./SourcesTab";

const paragraphs = (text: string) => text.split(/\n+/).filter((p) => p.trim());
const TEXT = { m: 0, fontSize: "0.875rem", lineHeight: 1.55, color: "var(--text)", maxWidth: "72ch", overflowWrap: "anywhere" } as const;

/** A titled panel whose body is AI text in the dashed box, closed by the "Written by AI" label. */
function AiPanel({ title, note, label, lead, children }: { title: string; note?: string; label: string; lead?: boolean; children: ReactNode }) {
  return (
    <Panel component="section" aria-label={title} sx={{ p: { xs: "16px", md: "20px" }, display: "grid", gap: 1.5, alignContent: "start", minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
        <Typography component="h2" sx={H3}>
          {title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {note && <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{note}</Typography>}
      </Box>
      <Box sx={{ borderStyle: "dashed", borderWidth: "1px", borderColor: "var(--line2)", borderRadius: "14px", p: "16px 18px", display: "grid", gap: 1, minWidth: 0, ...(lead ? { "& > p:not(:last-child)": { fontSize: "0.9375rem" } } : {}) }}>
        {children}
        <Typography sx={{ mt: 0.75, display: "flex", alignItems: "center", gap: 0.75, fontSize: "0.75rem", color: "var(--muted)" }}>
          <Sparkles size={13} color="var(--accent)" aria-hidden />
          {label}
        </Typography>
      </Box>
    </Panel>
  );
}

function Paragraphs({ text, empty }: { text: string; empty: string }) {
  const list = paragraphs(text);
  return (
    <>
      {(list.length ? list : [empty]).map((p, i) => (
        <Typography key={`${i}-${p}`} sx={TEXT}>
          {p}
        </Typography>
      ))}
    </>
  );
}

const cited = (n: number) => `Written by AI${n > 0 ? ` · ${n} cited source${n === 1 ? "" : "s"}` : ""}`;

function Catalysts({ idea }: { idea: IdeaOut }) {
  const rows = idea.catalysts.map((c) => (typeof c === "string" ? { text: c, occurs_on: null, evidence: [] as string[] } : c)).filter((c) => c.text.trim());
  if (rows.length === 0) return null;
  return (
    <AiPanel title="Catalysts" note="Dated events only" label="Written by AI">
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "grid" }}>
        {rows.map((c, i) => (
          <Box
            component="li"
            key={`${i}-${c.text}`}
            sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: c.occurs_on ? "96px minmax(0, 1fr)" : "minmax(0, 1fr)" }, gap: { xs: "2px", md: "12px" }, py: "10px", ...TEXT, borderTop: "1px solid var(--line)", "&:first-of-type": { borderTop: 0, pt: 0 } }}
          >
            {c.occurs_on && (
              <Box component="time" dateTime={c.occurs_on} sx={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>
                {calendarDateText(c.occurs_on)}
              </Box>
            )}
            <Box sx={{ display: "grid", gap: 0.5, minWidth: 0, overflowWrap: "anywhere" }}>
              <span>{c.text}</span>
              {c.evidence.length > 0 && (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, fontSize: "0.75rem" }}>
                  {c.evidence.map((url) => (
                    <SourceLink key={url} url={url} />
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </AiPanel>
  );
}

/**
 * The Overview tab of an ETF idea, in the approved mock's order: what 5% of the fund does to the
 * portfolio, then the AI text (role, catalysts and bear case, conclusion) and the sources. On a
 * phone `withSide` puts the fund facts and quality filter before the sources; on a desktop they
 * sit in the right column under the decision rail.
 */
export function EtfOverview({ idea, withSide = false }: { idea: IdeaOut; withSide?: boolean }) {
  const hasCatalysts = idea.catalysts.some((c) => (typeof c === "string" ? c : c.text).trim());
  const bearClaims = idea.sources.filter((c) => c.stance === "bear").length;
  return (
    <Box sx={{ display: "grid", gap: 2, minWidth: 0 }}>
      <EtfHero idea={idea} />
      <AiPanel title="The role it plays" label={cited(idea.sources.length)} lead>
        <Paragraphs text={[idea.thesis, idea.outlook].join("\n")} empty="No thesis was saved for this idea." />
      </AiPanel>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: hasCatalysts ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)" }, alignItems: "start" }}>
        <Catalysts idea={idea} />
        <AiPanel title="Bear case" note="What could go wrong" label={cited(bearClaims)}>
          <Paragraphs text={idea.bear_case} empty="No bear case was saved for this idea." />
        </AiPanel>
      </Box>
      {idea.conclusion.trim() && (
        <AiPanel title="Conclusion" label="Written by AI" lead>
          <Paragraphs text={idea.conclusion} empty="" />
        </AiPanel>
      )}
      {withSide && <EtfSideColumn idea={idea} />}
      <SourcesTab idea={idea} />
    </Box>
  );
}
