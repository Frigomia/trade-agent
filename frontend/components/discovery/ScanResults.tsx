import { Alert, Box, Typography } from "@mui/material";
import type { Exclusion, RejectedMention, ScanRun } from "@/lib/api/discovery-types";
import { dateTimeText, scanCounts } from "@/lib/discovery";
import { toTime } from "@/lib/format";
import { Panel } from "@/components/ui/Panel";
import { SourceLink } from "@/components/workbench/Cases";

const reasons: Record<Exclusion["reason"] | RejectedMention["reason"], string> = {
  thesis_invalidated: "Thesis invalidated",
  unreliable_price: "Unreliable price",
  ambiguous_identity: "Ambiguous identity",
  currency_unsupported: "Currency unsupported",
  insufficient_data: "Insufficient data",
  ambiguous: "Ambiguous identity",
  unresolved: "Company could not be resolved",
  no_price: "No usable price",
  cap_reached: "Mention admission limit reached",
  duplicate: "Already considered",
};
const row = { py: 2, borderTop: "1px solid var(--line)", overflowWrap: "anywhere" } as const;
const heading = { fontSize: "0.9375rem", fontWeight: 650 } as const;
const body = { fontSize: "0.8125rem", color: "var(--text2)", mt: 0.5 } as const;

function Evidence({ urls }: { urls: string[] }) {
  return urls.length ? (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1, fontSize: "0.75rem", "& a": { minHeight: 44, alignItems: "center" } }}>
      <span>Cited evidence:</span>
      {[...new Set(urls)].map((url) => <SourceLink key={url} url={url} />)}
    </Box>
  ) : <Typography sx={body}>No cited evidence saved.</Typography>;
}

function ExcludedRow({ item }: { item: Exclusion }) {
  return (
    <Box component="li" sx={row}>
      <Typography component="h3" sx={heading}>{item.name} · {item.ticker}</Typography>
      <Typography sx={body}>{reasons[item.reason]}</Typography>
      <Typography sx={body}>{item.explanation}</Typography>
      <Evidence urls={item.evidence} />
    </Box>
  );
}

/** Saved scan results only. Screening failures never inflate the researched set-aside count. */
export function ScanResults({ scan, now }: { scan: ScanRun | null; now: number }) {
  if (!scan) return <Panel sx={{ p: 2.5 }}><Typography component="h2" sx={heading}>No scan yet</Typography><Typography sx={body}>Run your first scan from Today to see its results here.</Typography></Panel>;
  const excluded = scan.excluded ?? [];
  // Only thesis invalidations come from the research graph; other exclusions stop at screening.
  const researched = excluded.filter((item) => item.reason === "thesis_invalidated");
  const screening = excluded.filter((item) => item.reason !== "thesis_invalidated");
  const mentions = scan.rejected_mentions ?? [];
  const coverage = scan.coverage_summary;
  const nonOpportunities = coverage.non_opportunities ?? [];
  const missingDetails = scan.set_aside === null || researched.length + nonOpportunities.length !== scan.set_aside;

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Typography sx={body}>Saved {dateTimeText(scan.created_at)} · {scanCounts(scan).join(" · ") || "Counts unavailable for this scan"}</Typography>
      {now - toTime(scan.created_at) > 24 * 60 * 60 * 1000 && <Alert severity="warning">Older scan. These results reflect the saved date. Return to Today to refresh.</Alert>}
      <Typography sx={body}>{scan.summary}</Typography>
      <Typography sx={body}>Reading saved results costs no runs. Set aside counts researched candidates only; screening exclusions and rejected mentions are separate.</Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 2fr) minmax(0, 1fr)" }, gap: 2, alignItems: "start" }}>
        <Box sx={{ display: "grid", gap: 2 }}>
          <Panel component="section" sx={{ p: 2.5 }}>
            <Typography component="h2" sx={heading}>Set aside after research · {scan.set_aside ?? "count unavailable"}</Typography>
            {missingDetails && <Alert severity="info" sx={{ my: 1 }}>Full researched-result details were not saved for this scan. Available records are shown below; the saved count has not changed.</Alert>}
            {scan.set_aside === 0 && <Typography sx={body}>Nothing set aside after research.</Typography>}
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {researched.map((item) => <ExcludedRow key={item.ticker} item={item} />)}
              {nonOpportunities.map((item) => (
                <Box component="li" key={item.ticker} sx={row}>
                  <Typography component="h3" sx={heading}>{item.name} · {item.ticker}</Typography>
                  <Typography sx={body}>{item.overall === null ? "Score unavailable" : `Score ${item.overall}/100` } · {item.confidence} confidence</Typography>
                  <Typography sx={body}>Did not meet the opportunity threshold: score at least 60 and medium or high confidence.</Typography>
                  <Typography sx={body}>{item.explanation}</Typography>
                  {item.data_notes.map((note) => <Typography key={note} sx={body}>{note}</Typography>)}
                  <Evidence urls={item.evidence} />
                </Box>
              ))}
            </Box>
          </Panel>
          <Panel component="section" sx={{ p: 2.5 }}>
            <Typography component="h2" sx={heading}>Excluded before research · {screening.length}</Typography>
            {!screening.length && <Typography sx={body}>No screening exclusions saved.</Typography>}
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>{screening.map((item) => <ExcludedRow key={item.ticker} item={item} />)}</Box>
          </Panel>
          <Panel component="section" sx={{ p: 2.5 }}>
            <Typography component="h2" sx={heading}>Rejected mentions · {mentions.length}</Typography>
            {!mentions.length && <Typography sx={body}>No rejected mentions saved.</Typography>}
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {mentions.map((item, index) => (
                // Saved mention order is immutable; duplicate names/URLs are valid rejection records.
                <Box component="li" key={`${item.mention.name}:${index}`} sx={row}>
                  <Typography component="h3" sx={heading}>{item.mention.name}{item.mention.ticker_hint ? ` · ${item.mention.ticker_hint}` : ""}</Typography>
                  <Typography sx={body}>{reasons[item.reason]}</Typography>
                  <Typography sx={body}>Unverified web mention · {item.mention.origin}{item.mention.exchange_hint ? ` · ${item.mention.exchange_hint}` : ""}</Typography>
                  <Typography sx={body}>{item.mention.reason}</Typography>
                  {item.mention.url && <Evidence urls={[item.mention.url]} />}
                </Box>
              ))}
            </Box>
          </Panel>
        </Box>
        <Panel component="section" sx={{ p: 2.5 }}>
          <Typography component="h2" sx={heading}>Coverage</Typography>
          <Typography sx={body}>{scan.universe_size} universe companies · {scan.eligible} eligible · {scan.shortlisted} shortlisted · {scan.researched} researched</Typography>
          <Typography sx={body}>{coverage.snapshot_symbols === undefined ? "Snapshot count unavailable" : `${coverage.snapshot_symbols} saved snapshots`}</Typography>
          <Typography sx={body}>{coverage.mentions_available === undefined ? "Mention availability not recorded" : coverage.mentions_available ? "Daily mentions available" : "Daily mentions unavailable"}</Typography>
          {([
            ["Missing snapshots", coverage.missing_snapshot_symbols],
            ["Stale quotes", coverage.stale_symbols],
            ["Uncertain quote dates", coverage.uncertain_price_symbols],
            ["Research failures", coverage.candidate_failures],
          ] as const).map(([label, symbols]) => (
            <Box key={label} sx={{ ...row, fontSize: "0.8125rem", "& summary": { minHeight: 44, cursor: "pointer" } }}>
              {symbols ? <details><summary>{label} · {symbols.length}</summary><Typography sx={{ ...body, overflowWrap: "anywhere" }}>{symbols.join(", ") || "None"}</Typography></details> : `${label}: not recorded`}
            </Box>
          ))}
          {!!coverage.nearest_misses?.length && <><Typography component="h3" sx={heading}>Nearest misses</Typography>{coverage.nearest_misses.map((item) => <Typography key={item.ticker} sx={body}>{item.name ?? item.ticker} · {item.ticker} · {item.overall ?? "Score unavailable"} · {item.confidence} confidence</Typography>)}</>}
          <Typography sx={body}>Coverage is limited to the saved universe and available data.</Typography>
        </Panel>
      </Box>
    </Box>
  );
}
