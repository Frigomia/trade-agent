import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { Users } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { quoteLabel } from "@/lib/discovery";
import { BODY, H3, SourceLink, TIER_LABEL } from "./Cases";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ display: "grid", gap: 1, alignContent: "start" }}>
      <Typography component="h4" sx={{ ...H3, fontSize: "0.8125rem" }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** The Sources tab: every cited source, the data's limits, what is unresolved, and the community view. */
export function SourcesTab({ idea }: { idea: IdeaOut }) {
  const open = idea.negative_developments.filter((d) => d.status !== "confirmed");
  const unverified = idea.sources.filter((s) => s.source_tier === "forum").length;
  return (
    <Box sx={{ display: "grid", gap: 2, minWidth: 0 }}>
      <Panel component="section" sx={{ p: "20px", display: "grid", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
          <Typography component="h3" sx={H3}>
            Sources and research transparency
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            {idea.sources.length} source{idea.sources.length === 1 ? "" : "s"}
            {unverified > 0 ? ` · ${unverified} unverified` : ""}
          </Typography>
        </Box>
        {idea.sources.length === 0 ? (
          <Typography sx={BODY}>No sources were saved with this idea.</Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
            {idea.sources.map((s, i) => (
              <Box component="li" key={`${i}-${s.url}`} sx={{ display: "grid", gap: 0.25, py: 1.25, borderTop: "1px solid var(--line)", "&:first-of-type": { borderTop: 0, pt: 0 } }}>
                <Typography sx={{ ...BODY, color: "var(--text)" }}>{s.text}</Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, fontSize: "0.75rem", color: "var(--muted)" }}>
                  <SourceLink url={s.url} />
                  <span>· {TIER_LABEL[s.source_tier]}</span>
                  {s.published_at && <span>· {s.published_at}</span>}
                </Box>
              </Box>
            ))}
          </Box>
        )}
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }, mt: 1 }}>
          <Block title="Data timestamps and limits">
            <Box component="ul" sx={{ m: 0, pl: 2.25, display: "grid", gap: 0.5, ...BODY }}>
              <li>{quoteLabel(idea)}.</li>
              {idea.data_notes.map((note, i) => (
                <li key={`${i}-${note}`}>{note}</li>
              ))}
            </Box>
          </Block>
          <Block title="Unresolved or conflicting evidence">
            {open.length === 0 ? (
              <Typography sx={BODY}>Nothing disputed or unverified was found.</Typography>
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 2.25, display: "grid", gap: 0.5, ...BODY }}>
                {open.map((d, i) => (
                  <li key={`${i}-${d.summary}`}>
                    {d.summary} ({d.status})
                  </li>
                ))}
              </Box>
            )}
          </Block>
        </Box>
        {idea.community_note && (
          <Box sx={{ border: "1px dashed var(--line2)", borderRadius: "14px", p: "14px 16px", display: "grid", gap: 0.5 }}>
            <Typography component="h4" sx={{ ...H3, fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: 0.75 }}>
              <Users size={14} aria-hidden /> Unverified community opinion
            </Typography>
            <Typography sx={BODY}>{idea.community_note}</Typography>
            <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>Not checked, and not used in any score.</Typography>
          </Box>
        )}
      </Panel>
    </Box>
  );
}
