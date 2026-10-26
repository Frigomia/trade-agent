import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { CircleAlert, CircleCheck, CircleHelp, ExternalLink, Sparkles } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { Claim, IdeaOut, NegativeDevelopment } from "@/lib/api/discovery-types";
import { hostOf, safeHref } from "@/lib/safeHref";
import { calendarDateText } from "@/lib/discovery";

export const BODY = { fontSize: "0.8125rem", color: "var(--text2)", lineHeight: 1.55 } as const;
export const H3 = { fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" } as const;

export const TIER_LABEL: Record<Claim["source_tier"], string> = {
  official: "Official",
  reliable_reporting: "Reliable reporting",
  other: "Other source",
  forum: "Forum, unverified",
};

const KIND_LABEL: Record<Claim["kind"], string> = { fact: "Fact", opinion: "Opinion", forecast: "Forecast", forum: "Forum post" };

// Shape plus word, never green or red.
const STATUS: Record<NegativeDevelopment["status"], { label: string; icon: typeof CircleCheck }> = {
  confirmed: { label: "Confirmed", icon: CircleCheck },
  disputed: { label: "Disputed", icon: CircleAlert },
  unverified: { label: "Unverified", icon: CircleHelp },
};

function ClaimStatus({ status }: { status: NegativeDevelopment["status"] }) {
  const { label, icon: Icon } = STATUS[status];
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, border: "1px solid var(--line2)", borderStyle: status === "confirmed" ? "solid" : status === "disputed" ? "dashed" : "dotted", borderRadius: 999, px: 1, color: "var(--text2)" }}>
      <Icon size={13} aria-hidden />{label}
    </Box>
  );
}

/** A link that opens a web source safely, or the plain text when the address is not http(s). */
export function SourceLink({ url, children }: { url: string; children?: ReactNode }) {
  const href = safeHref(url);
  const label = children ?? hostOf(url);
  if (!href) return <span>{label}</span>;
  return (
    <Box component="a" href={href} target="_blank" rel="noopener noreferrer" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      {label}
      <ExternalLink size={12} aria-hidden />
    </Box>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <Box component="li" sx={{ display: "grid", gap: 0.5, py: 1.25, borderTop: "1px solid var(--line)", "&:first-of-type": { borderTop: 0, pt: 0 } }}>
      <Typography sx={{ ...BODY, color: "var(--text)" }}>{claim.text}</Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, fontSize: "0.75rem", color: "var(--muted)", alignItems: "center" }}>
        <ClaimStatus status={claim.status ?? "unverified"} />
        <Box component="span" sx={{ border: "1px solid var(--line2)", borderRadius: 999, px: 1, fontWeight: 500, color: "var(--text2)" }}>
          {KIND_LABEL[claim.kind]}
        </Box>
        <span>{TIER_LABEL[claim.source_tier]}</span>
        {claim.published_at && <span>· {claim.published_at}</span>}
        <SourceLink url={claim.url} />
      </Box>
    </Box>
  );
}

function Case({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <Panel component="section" sx={{ p: "20px", display: "grid", gap: 1.5, alignContent: "start" }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
        <Typography component="h3" sx={H3}>
          {title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>{note}</Typography>
      </Box>
      <Box sx={{ borderStyle: "dashed", borderWidth: "1px", borderColor: "var(--line2)", borderRadius: "14px", p: "14px 16px", display: "grid", gap: 1.5, minWidth: 0 }}>{children}</Box>
    </Panel>
  );
}

const plural = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

/** What could go right: the supporting claims, then the catalysts the research found. */
export function BullCase({ idea }: { idea: IdeaOut }) {
  const claims = idea.sources.filter((c) => c.stance === "bull");
  const catalysts = idea.catalysts.map((c) => typeof c === "string" ? { text: c, occurs_on: null, evidence: [] } : c).filter((c) => c.text.trim());
  return (
    <Case title="Bull case" note="What could go right">
      {claims.length > 0 ? (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
          {claims.map((c, i) => (
            <ClaimRow key={`${i}-${c.url}`} claim={c} />
          ))}
        </Box>
      ) : (
        <Typography sx={BODY}>No supporting claims were saved with this idea.</Typography>
      )}
      {catalysts.length > 0 && (
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Typography component="h4" sx={{ fontSize: "0.75rem", fontWeight: 650, color: "var(--text2)" }}>
            Why now
          </Typography>
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 0.75 }}>
            {catalysts.map((c, i) => (
              <Box component="li" key={`${i}-${c.text}`} sx={{ display: "flex", gap: 1, minWidth: 0, overflowWrap: "anywhere", ...BODY }}>
                <Sparkles size={14} color="var(--accent)" aria-hidden style={{ flex: "none", marginTop: 3 }} />
                <Box sx={{ display: "grid", gap: 0.5, minWidth: 0 }}>
                  <span>{c.text}</span>
                  {c.occurs_on && <Box component="time" dateTime={c.occurs_on} sx={{ fontSize: "0.75rem", fontWeight: 650, color: "var(--text2)" }}>{calendarDateText(c.occurs_on)}</Box>}
                  {c.evidence.length > 0 && <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, fontSize: "0.75rem" }}>{c.evidence.map((url) => <SourceLink key={url} url={url} />)}</Box>}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>AI research summary · {plural(claims.length + catalysts.length)}</Typography>
    </Case>
  );
}

/** What could go wrong, at equal weight: the risk to the thesis, the bear claims, what has gone wrong. */
export function BearCase({ idea }: { idea: IdeaOut }) {
  const claims = idea.sources.filter((c) => c.stance === "bear");
  return (
    <Case title="Bear case" note="What could go wrong">
      <Typography sx={{ ...BODY, whiteSpace: "pre-line" }}>{idea.bear_case.trim() || "No bear case was saved for this idea."}</Typography>
      {claims.length > 0 && (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
          {claims.map((c, i) => (
            <ClaimRow key={`${i}-${c.url}`} claim={c} />
          ))}
        </Box>
      )}
      {idea.negative_developments.length > 0 && (
        <Box sx={{ display: "grid", gap: 1 }}>
          <Typography component="h4" sx={{ fontSize: "0.75rem", fontWeight: 650, color: "var(--text2)" }}>
            Material negative developments
          </Typography>
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 1.25 }}>
            {idea.negative_developments.map((d, i) => {
              const { label, icon: Icon } = STATUS[d.status];
              return (
                <Box component="li" key={`${i}-${d.summary}`} sx={{ display: "grid", gap: 0.5 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", fontSize: "0.75rem", color: "var(--text2)", fontWeight: 500 }}>
                    <Icon size={14} aria-hidden />
                    {label}
                    {d.occurred_on && <span>· {d.occurred_on}</span>}
                    <span>· {d.invalidates_thesis ? "Invalidates the thesis" : "Thesis still stands"}</span>
                  </Box>
                  <Typography sx={{ ...BODY, color: "var(--text)" }}>{d.summary}</Typography>
                  <Typography sx={BODY}>Effect on the thesis: {d.thesis_impact}</Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
      <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
        AI research summary · {plural(claims.length + idea.negative_developments.length)}
      </Typography>
    </Case>
  );
}
