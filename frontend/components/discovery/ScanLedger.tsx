"use client";

import { useId, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { ChevronRight, ExternalLink, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { hostOf, safeHref } from "@/lib/safeHref";
import { ORIGIN_WORDS, type LedgerRow } from "@/lib/scanResults";

// Company | where it fell out | why | chevron. A phone stacks the row into one column.
const GRID = {
  display: "grid",
  gridTemplateColumns: { xs: "minmax(0, 1fr) 24px", md: "minmax(0, 1.5fr) 190px minmax(0, 1.3fr) 24px" },
  gridTemplateAreas: { xs: '"who chv" "stage chv" "why chv"', md: '"who stage why chv"' },
  columnGap: { xs: 1.25, md: 1.75 },
  rowGap: 0.25,
  alignItems: "center",
} as const;

const WEB_BOX = {
  border: "1px dashed var(--line2)",
  borderRadius: "14px",
  p: "10px 14px",
  fontSize: "0.8125rem",
  lineHeight: 1.55,
  color: "var(--text2)",
  overflowWrap: "anywhere",
} as const;

const NOTE = { fontSize: "0.75rem", color: "var(--muted)", mt: 1 } as const;

/** A source link only when it is a plain web address; anything else is text, never a link. */
function Source({ url }: { url: string }) {
  const href = safeHref(url);
  const label = hostOf(url);
  const sx = { display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: { xs: 44, md: 36 }, px: 1.5, borderRadius: 999, border: "1px solid var(--line2)", fontSize: "0.75rem", overflowWrap: "anywhere" } as const;
  return href ? (
    <Box component="a" href={href} target="_blank" rel="noopener noreferrer" sx={{ ...sx, color: "var(--accent)", textDecoration: "none" }}>
      {label}
      <ExternalLink size={13} aria-hidden />
    </Box>
  ) : (
    <Box component="span" sx={{ ...sx, color: "var(--muted)", borderStyle: "dashed" }}>
      {label}
    </Box>
  );
}

function Detail({ row }: { row: LedgerRow }) {
  const d = row.detail;
  if (d.kind === "thesis") {
    return (
      <>
        <Box sx={WEB_BOX}>
          {d.explanation}
          <Typography component="span" sx={{ ...NOTE, display: "block" }}>
            Written by the scan from the sources below. Check them before relying on it.
          </Typography>
        </Box>
        {d.evidence.length > 0 && (
          <Box role="group" aria-label={`Evidence for ${row.name}`} sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {d.evidence.map((url, i) => (
              <Source key={`${i}:${url}`} url={url} />
            ))}
          </Box>
        )}
      </>
    );
  }
  if (d.kind === "bar") {
    return (
      <Typography sx={{ fontSize: "0.75rem", color: "var(--text2)", lineHeight: 1.5, fontVariantNumeric: "tabular-nums" }}>
        {d.overall === null ? "No score" : `Score ${d.overall}`} · {d.confidence[0].toUpperCase() + d.confidence.slice(1)} confidence. Researched, but it did not reach the score and confidence bar.
      </Typography>
    );
  }
  if (d.kind === "note") {
    return <Typography sx={{ fontSize: "0.75rem", color: "var(--text2)", lineHeight: 1.5 }}>{d.text}</Typography>;
  }
  const origin = (ORIGIN_WORDS[d.origin] ?? d.origin).toLowerCase();
  return (
    <>
      <Box sx={WEB_BOX}>
        {d.sentence}
        <Typography component="span" sx={{ ...NOTE, display: "block" }}>
          From {origin}, not checked by us.
        </Typography>
      </Box>
      {d.url && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Source url={d.url} />
        </Box>
      )}
    </>
  );
}

function Reason({ row }: { row: LedgerRow }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        minHeight: 28,
        px: 1.5,
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 500,
        color: row.thesis ? "var(--warn)" : "var(--text2)",
        bgcolor: row.thesis ? "var(--warn-bg)" : "transparent",
        border: row.thesis ? "1px solid color-mix(in srgb, var(--warn) 22%, transparent)" : "1px solid var(--line2)",
      }}
    >
      {row.thesis && <TriangleAlert size={13} aria-hidden />}
      {row.reason}
    </Box>
  );
}

const DOT: Record<LedgerRow["group"], string> = { set: "var(--warn)", not: "var(--line2)", men: "var(--accent)" };

function LedgerItem({ row, open, onToggle }: { row: LedgerRow; open: boolean; onToggle: () => void }) {
  const panelId = useId();
  return (
    <Box sx={{ borderTop: "1px solid var(--line)", "&:first-of-type": { borderTop: 0 } }}>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
        sx={{ ...GRID, width: "100%", minHeight: { xs: 76, md: 56 }, py: { xs: 1.5, md: 0.75 }, bgcolor: "transparent", border: 0, textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", "&:focus-visible": { outline: "2px solid var(--focus)", outlineOffset: 2, borderRadius: "10px" } }}
      >
        <Box sx={{ gridArea: "who", display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
          <Typography component="span" sx={{ fontWeight: 650, fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.name}
          </Typography>
          {row.ticker && (
            <Typography component="span" sx={{ fontFamily: '"Geist Mono", ui-monospace, monospace', fontSize: "0.75rem", color: "var(--muted)" }}>
              {row.ticker}
            </Typography>
          )}
        </Box>
        <Box component="span" sx={{ gridArea: "stage", display: "inline-flex", alignItems: "center", gap: 1, fontSize: "0.75rem", color: "var(--text2)" }}>
          <Box aria-hidden component="span" sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: DOT[row.group], flex: "none" }} />
          {row.stage}
        </Box>
        <Box component="span" sx={{ gridArea: "why", mt: { xs: 0.5, md: 0 } }}>
          <Reason row={row} />
        </Box>
        <ChevronRight size={16} aria-hidden style={{ gridArea: "chv", justifySelf: "center", color: "var(--muted)", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
      </Box>
      {open && (
        <Box id={panelId} sx={{ display: "grid", gap: 1.25, pb: 2, maxWidth: 760 }}>
          <Detail row={row} />
        </Box>
      )}
    </Box>
  );
}

/**
 * The ledger of everything a scan left out: one row per company or mention, each opening to its
 * explanation and sources. Rows open independently; the first one starts open.
 */
export function ScanLedger({ rows, hidden, onShowMore, empty }: { rows: LedgerRow[]; hidden: number; onShowMore: () => void; empty: string }) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set(rows.slice(0, 1).map((r) => r.key)));
  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <Panel component="section" aria-label="Everything the scan left out" sx={{ px: { xs: "14px", md: "20px" }, py: "4px", pb: 1 }}>
      {rows.length > 0 && (
        <Box aria-hidden sx={{ ...GRID, display: { xs: "none", md: "grid" }, gridTemplateAreas: undefined, py: 1.25, fontSize: "0.75rem", fontWeight: 500, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
          <span>Company</span>
          <span>Where it fell out</span>
          <span>Why</span>
          <span />
        </Box>
      )}
      {rows.length === 0 ? (
        <Typography sx={{ py: 2.25, fontSize: "0.8125rem", color: "var(--muted)" }}>{empty}</Typography>
      ) : (
        <Box>
          {rows.map((row) => (
            <LedgerItem key={row.key} row={row} open={openKeys.has(row.key)} onToggle={() => toggle(row.key)} />
          ))}
        </Box>
      )}
      {hidden > 0 && (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 1.5, pb: 0.75, borderTop: "1px solid var(--line)" }}>
          <Button variant="outlined" size="small" onClick={onShowMore} sx={{ borderRadius: 999, minHeight: { xs: 44, md: 36 }, fontSize: "0.75rem" }}>
            Show {hidden} more
          </Button>
        </Box>
      )}
    </Panel>
  );
}
