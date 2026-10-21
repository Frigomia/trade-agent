import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { CircleAlert, CircleCheck, CircleHelp, ExternalLink, Sparkles } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { Claim, IdeaOut, NegativeDevelopment } from "@/lib/api/discovery-types";

const BODY = { fontSize: "0.8125rem", color: "var(--text2)", lineHeight: 1.55 } as const;
const H3 = { fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" } as const;

/** Links from the web are shown only when they are plain http(s); anything else is just text. */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const TIER_LABEL: Record<Claim["source_tier"], string> = {
  official: "Official",
  reliable_reporting: "Reliable reporting",
  other: "Other source",
  forum: "Forum, unverified",
};

// Shape plus word, never green or red: confirmed is a filled check, disputed an alert, unverified a question mark.
const STATUS: Record<NegativeDevelopment["status"], { label: string; icon: typeof CircleCheck }> = {
  confirmed: { label: "Confirmed", icon: CircleCheck },
  disputed: { label: "Disputed", icon: CircleAlert },
  unverified: { label: "Unverified", icon: CircleHelp },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ display: "grid", gap: 1 }}>
      <Typography component="h3" sx={H3}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Link({ url, children }: { url: string; children: ReactNode }) {
  const href = safeHref(url);
  if (!href) return <span>{children}</span>;
  return (
    <Box component="a" href={href} target="_blank" rel="noopener noreferrer" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      {children}
      <ExternalLink size={12} aria-hidden />
    </Box>
  );
}

/**
 * The saved research behind a discovery idea, in full, for the page where the decision is made:
 * the thesis (AI text, in the dashed box), the risk to it at equal weight, what has gone wrong,
 * the cited sources and what the data could not show. Nothing here is clamped.
 */
export function IdeaEvidence({ idea }: { idea: IdeaOut }) {
  const catalysts = idea.catalysts.filter((c) => c.trim());
  return (
    <Box sx={{ display: "grid", gap: 2, mt: 2.5 }} aria-label="Research behind this idea">
      <Box sx={{ border: "1px dashed var(--line2)", borderRadius: "14px", p: "16px 18px", display: "grid", gap: 1 }}>
        <Typography component="h3" sx={H3}>
          Thesis
        </Typography>
        <Typography sx={{ ...BODY, color: "var(--text)", whiteSpace: "pre-line" }}>{idea.thesis}</Typography>
        {idea.outlook.trim() && <Typography sx={BODY}>{idea.outlook}</Typography>}
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          AI research summary · {idea.sources.length} cited source{idea.sources.length === 1 ? "" : "s"}
        </Typography>
      </Box>

      {catalysts.length > 0 && (
        <Section title="Why now">
          <Box component="ul" sx={{ m: 0, pl: 0, listStyle: "none", display: "grid", gap: 0.75 }}>
            {catalysts.map((c, i) => (
              <Box component="li" key={`${i}-${c}`} sx={{ display: "flex", gap: 1, ...BODY }}>
                <Sparkles size={14} color="var(--accent)" aria-hidden style={{ flex: "none", marginTop: 3 }} />
                <span>{c}</span>
              </Box>
            ))}
          </Box>
        </Section>
      )}

      <Panel sx={{ p: "16px 18px", display: "grid", gap: 1 }}>
        <Typography component="h3" sx={H3}>
          Risk to the thesis
        </Typography>
        <Typography sx={{ ...BODY, whiteSpace: "pre-line" }}>{idea.bear_case.trim() || "No bear case was saved for this idea."}</Typography>
      </Panel>

      {idea.negative_developments.length > 0 && (
        <Section title="What has gone wrong">
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 1.25 }}>
            {idea.negative_developments.map((d, i) => {
              const { label, icon: Icon } = STATUS[d.status];
              return (
                <Panel component="li" key={`${i}-${d.summary}`} sx={{ p: "12px 14px", display: "grid", gap: 0.5 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", fontSize: "0.75rem", color: "var(--text2)", fontWeight: 500 }}>
                    <Icon size={14} aria-hidden />
                    {label}
                    {d.occurred_on && <span>· {d.occurred_on}</span>}
                    {d.invalidates_thesis && <span>· Invalidates the thesis</span>}
                  </Box>
                  <Typography sx={{ ...BODY, color: "var(--text)" }}>{d.summary}</Typography>
                  <Typography sx={BODY}>Effect on the thesis: {d.thesis_impact}</Typography>
                </Panel>
              );
            })}
          </Box>
        </Section>
      )}

      {idea.fit_summary && (
        <Section title="Fit with your portfolio">
          <Typography sx={BODY}>{idea.fit_summary}</Typography>
        </Section>
      )}

      {idea.community_note && (
        <Section title="Community view, unverified">
          <Typography sx={BODY}>{idea.community_note}</Typography>
        </Section>
      )}

      {idea.sources.length > 0 && (
        <Section title="Sources">
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "grid" }}>
            {idea.sources.map((s, i) => (
              <Box component="li" key={`${i}-${s.url}`} sx={{ display: "grid", gap: 0.25, py: 1, borderTop: "1px solid var(--line)", "&:first-of-type": { borderTop: 0 } }}>
                <Typography sx={{ ...BODY, color: "var(--text)" }}>{s.text}</Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, fontSize: "0.75rem", color: "var(--muted)" }}>
                  <Link url={s.url}>{host(s.url)}</Link>
                  <span>· {TIER_LABEL[s.source_tier]}</span>
                  {s.published_at && <span>· {s.published_at}</span>}
                </Box>
              </Box>
            ))}
          </Box>
        </Section>
      )}

      {idea.data_notes.length > 0 && (
        <Section title="What the data could not show">
          <Box component="ul" sx={{ m: 0, pl: 2.25, display: "grid", gap: 0.5, ...BODY }}>
            {idea.data_notes.map((note, i) => (
              <li key={`${i}-${note}`}>{note}</li>
            ))}
          </Box>
        </Section>
      )}
    </Box>
  );
}
