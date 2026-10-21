import type { ReactNode } from "react";
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import type { IdeaOut, PeerComparison, PeerRow } from "@/lib/api/discovery-types";
import { bandLayout, eurCompact, formatMetric, metricLabel, peerGroupLabel, peerNote, POSITION_WORD } from "@/lib/metrics";
import { BODY, H3 } from "./Cases";

const POSITION_ICON = { below: ArrowDown, within: Minus, above: ArrowUp } as const;

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Panel component="section" sx={{ p: "20px", display: "grid", gap: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
        <Typography component="h3" sx={H3}>
          {title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {right}
      </Box>
      {children}
    </Panel>
  );
}

const muted = { fontSize: "0.75rem", color: "var(--muted)" } as const;

/** The figures to list: the scan's comparisons in their order, else whatever raw metrics were saved. */
function figures(idea: IdeaOut): { metric: string; value: number | null }[] {
  if (idea.peers && idea.peers.length > 0) return idea.peers.map((p) => ({ metric: p.metric, value: p.value }));
  return Object.entries(idea.snapshot?.fundamentals ?? {}).map(([metric, value]) => ({ metric, value }));
}

function Tiles({ items }: { items: { metric: string; value: number | null }[] }) {
  return (
    <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" } }}>
      {items.map(({ metric, value }) => {
        const text = formatMetric(metric, value);
        return (
          <Box
            key={metric}
            sx={{
              borderRadius: "14px",
              p: "12px 14px",
              display: "grid",
              gap: "2px",
              minWidth: 0,
              ...(text ? { bgcolor: "var(--track)" } : { borderStyle: "dashed", borderWidth: "1px", borderColor: "var(--line2)" }),
            }}
          >
            <Typography component="span" sx={{ fontSize: "0.75rem", color: "var(--text2)" }}>
              {metricLabel(metric)}
            </Typography>
            <Typography component="b" sx={{ fontSize: text ? "1.25rem" : "0.8125rem", fontWeight: text ? 650 : 500, letterSpacing: "-0.02em", color: text ? "var(--text)" : "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              {text ?? "Not available"}
            </Typography>
            {!text && <Typography component="span" sx={muted}>No source for this company</Typography>}
          </Box>
        );
      })}
    </Box>
  );
}

function Band({ c }: { c: PeerComparison }) {
  const layout = bandLayout(c);
  if (!layout || c.position === "unavailable") return null;
  const Icon = POSITION_ICON[c.position];
  const value = formatMetric(c.metric, c.value);
  const median = formatMetric(c.metric, c.peer_median);
  const note = peerNote(c);
  return (
    <Box sx={{ display: "grid", gap: 0.75 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", color: "var(--text2)" }}>
        <span>{metricLabel(c.metric)}</span>
        <Box component="b" sx={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</Box>
      </Box>
      <Box
        role="img"
        aria-label={`${metricLabel(c.metric)}: ${value}, peer median ${median}, ${POSITION_WORD[c.position].toLowerCase()}`}
        sx={{ position: "relative", height: 10, borderRadius: 999, bgcolor: "var(--track)", mt: 0.5 }}
      >
        <Box component="i" sx={{ position: "absolute", top: 0, height: "100%", left: `${layout.band.left}%`, width: `${layout.band.width}%`, bgcolor: "var(--accent-wash)", borderRadius: 999 }} />
        <Box component="i" sx={{ position: "absolute", top: -3, width: 2, height: 16, ml: "-1px", left: `${layout.median}%`, bgcolor: "var(--text2)" }} />
        <Box component="i" sx={{ position: "absolute", top: -2, width: 14, height: 14, ml: "-7px", left: `${layout.value}%`, borderRadius: "50%", bgcolor: "var(--accent)", border: "2px solid var(--panel)" }} />
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", ...muted }}>
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, color: "var(--text2)" }}>
          <Icon size={13} aria-hidden /> {POSITION_WORD[c.position]}
        </Box>
        <span>
          median {median}
          {note && ` · ${note}`}
        </span>
      </Box>
    </Box>
  );
}

function Peers({ idea }: { idea: IdeaOut }) {
  const rows = idea.peers ?? [];
  const bands = rows.filter((c) => c.position !== "unavailable" && bandLayout(c) !== null);
  const group = peerGroupLabel(bands);
  const noVerdict = rows.filter((c) => !bands.includes(c) && c.value !== null);
  if (bands.length === 0) {
    return (
      <Section title="Valuation and quality" right={<Typography sx={muted}>Peers unavailable</Typography>}>
        <Box sx={{ borderStyle: "dashed", borderWidth: "1px", borderColor: "var(--line2)", borderRadius: "14px", p: 2, display: "grid", gap: 0.5 }}>
          <Typography component="b" sx={{ fontSize: "1.25rem", fontWeight: 650 }}>
            No peer comparison
          </Typography>
          <Typography sx={BODY}>
            {rows.length === 0
              ? "No peer comparison was saved with this idea."
              : "Too few comparable companies were found, so the raw values are shown without a verdict."}
          </Typography>
        </Box>
        <Box component="dl" sx={{ m: 0, display: "grid" }}>
          {rows.map((c) => (
            <Box key={c.metric} sx={{ display: "flex", justifyContent: "space-between", py: 1, borderTop: "1px solid var(--line)", fontSize: "0.8125rem" }}>
              <Box component="dt" sx={{ color: "var(--text2)" }}>{metricLabel(c.metric)}</Box>
              <Box component="dd" sx={{ m: 0, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{formatMetric(c.metric, c.value) ?? "Not available"}</Box>
            </Box>
          ))}
        </Box>
      </Section>
    );
  }
  return (
    <Section title="Valuation and quality against peers" right={group ? <Typography sx={muted}>{group}</Typography> : undefined}>
      <Box sx={{ display: "grid", gap: 2.5 }}>
        {bands.map((c) => (
          <Band key={c.metric} c={c} />
        ))}
      </Box>
      {noVerdict.length > 0 && (
        <Typography sx={{ ...BODY, color: "var(--muted)" }}>
          No peer verdict for: {noVerdict.map((c) => `${metricLabel(c.metric)} ${formatMetric(c.metric, c.value)}`).join(", ")}.
        </Typography>
      )}
      <Typography sx={{ ...muted, maxWidth: "72ch" }}>
        Shaded band: the middle half of peers. Tick: the median. Dot: {idea.name}. Wording is neutral: lower is not automatically better.
      </Typography>
    </Section>
  );
}

const phone = (value: Record<string, unknown>) => ({ "@media (max-width: 899.95px)": value });

// Below `md` each row becomes a card: the company on the first line, the figures in two columns.
const TABLE_SX = {
  ...phone({
    display: "block",
    "& thead": { display: "none" },
    "& tbody": { display: "block" },
    "& tr": { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: "16px", rowGap: "8px", padding: "12px 0", borderBottom: "1px solid var(--line)" },
    "& td, & th": { display: "block", border: 0, padding: 0, minWidth: 0, textAlign: "left" },
    "& th[data-cell=name]": { gridColumn: "1 / -1" },
    "& td[data-label]::before": { content: "attr(data-label)", display: "block", fontSize: "0.6875rem", color: "var(--muted)" },
  }),
} as const;

/** The named-peer table: this company first, then the peers saved with the idea, side by side. */
function NamedPeers({ idea }: { idea: IdeaOut }) {
  const peers: PeerRow[] = idea.snapshot?.peers ?? [];
  const own = (idea.peers ?? []).filter((c) => c.value !== null).map((c) => c.metric);
  // Prefer the metrics at least one saved peer has a figure for, so the table is not a wall of dashes.
  const filled = own.filter((m) => peers.some((p) => p.values[m] !== null && p.values[m] !== undefined));
  const columns = (filled.length > 0 ? filled : own).slice(0, 3);
  const named = (idea.competitors ?? []).filter((n) => n.trim());
  return (
    <Section title="Named peers" right={<Typography sx={muted}>Same industry group, by size</Typography>}>
      {peers.length === 0 ? (
        <Typography sx={{ ...BODY, color: "var(--muted)" }}>Named peers are not available for this idea yet.</Typography>
      ) : (
        <Table size="small" sx={TABLE_SX} aria-label="Named peers">
          <TableHead>
            <TableRow>
              <TableCell>Company</TableCell>
              <TableCell>Country</TableCell>
              <TableCell align="right">Market cap</TableCell>
              {columns.map((m) => (
                <TableCell key={m} align="right">{metricLabel(m)}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            <PeerTableRow name={idea.name} ticker={idea.ticker} country={idea.snapshot?.country ?? null} cap={idea.risk.market_cap_eur} values={Object.fromEntries((idea.peers ?? []).map((c) => [c.metric, c.value]))} columns={columns} self />
            {peers.map((p, i) => (
              <PeerTableRow key={`${i}-${p.ticker}`} name={p.name} ticker={p.ticker} country={p.country} cap={p.market_cap_eur} values={p.values} columns={columns} />
            ))}
          </TableBody>
        </Table>
      )}
      {named.length > 0 && (
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Typography component="h4" sx={{ fontSize: "0.75rem", fontWeight: 650, color: "var(--text2)" }}>
            Also named in the research
          </Typography>
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 1 }}>
            {named.map((n) => (
              <Box component="li" key={n} sx={{ px: 1.5, minHeight: 28, display: "inline-flex", alignItems: "center", borderRadius: 999, bgcolor: "var(--track)", color: "var(--text2)", fontSize: "0.75rem" }}>
                {n}
              </Box>
            ))}
          </Box>
          <Typography sx={muted}>Names from web research, not checked and without figures.</Typography>
        </Box>
      )}
    </Section>
  );
}

function PeerTableRow({ name, ticker, country, cap, values, columns, self = false }: { name: string; ticker: string; country: string | null; cap: number | null; values: Record<string, number | null>; columns: string[]; self?: boolean }) {
  const dash = "Not available";
  return (
    <TableRow sx={self ? { bgcolor: "var(--accent-wash)" } : undefined}>
      <TableCell data-cell="name" component="th" scope="row" sx={{ fontWeight: self ? 650 : 500 }}>
        {name}
        <Box component="span" sx={{ ...muted, ml: 1 }}>
          {ticker}
          {self ? " · this company" : ""}
        </Box>
      </TableCell>
      <TableCell data-label="Country">{country ?? "—"}</TableCell>
      <TableCell data-label="Market cap" align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {eurCompact(cap) ?? dash}
      </TableCell>
      {columns.map((m) => (
        <TableCell key={m} data-label={metricLabel(m)} align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {formatMetric(m, values[m]) ?? dash}
        </TableCell>
      ))}
    </TableRow>
  );
}

/** The Numbers tab: the company's fundamentals, how they compare with peers, and the named peers. */
export function Numbers({ idea }: { idea: IdeaOut }) {
  const items = figures(idea);
  return (
    <Box sx={{ display: "grid", gap: 2, minWidth: 0 }}>
      <Section title="Fundamentals">
        {items.length === 0 ? <Typography sx={{ ...BODY, color: "var(--muted)" }}>No fundamentals were saved with this idea.</Typography> : <Tiles items={items} />}
      </Section>
      <Peers idea={idea} />
      <NamedPeers idea={idea} />
    </Box>
  );
}
